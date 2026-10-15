import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  applyMessages,
  assignMessage,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_PURPOSE,
  messageApplied,
  messageAssigned,
  messageRecorded,
  recordMessage,
  sendMessage,
  serializeMessageContent,
  textMessageContentInputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CallAgent,
  CallFrom,
  CallRef,
  CallReply,
  CallTo,
  CallToInput,
  InputDelivery,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { SessionDirectory } from "../../router/ports.ts";
import { attachedText } from "../run-loop/input-text.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { PermanentBlobReference } from "../../../protocol/storage/mod.ts";
import { closeAvailableRedo, createCheckpoint } from "./rewind/mod.ts";
import { checkVisualContent } from "../tools/visuals/mod.ts";
import {
  reject,
  requireUser,
  sessionNotFound,
  sessionVisible,
} from "./guards.ts";
import {
  linkExists,
  loadMessage,
  loadRunRef,
  loadSession,
  type MessageRow,
  sameLinks,
  snapshotOf,
} from "./model.ts";
import { titleOnReceive } from "./session-title.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. 같은 ID의 재전송은 내용이 같으면 이전
// 결과, 다르면 conflict다. 본문은 값으로 받는다. core가 redaction을 거쳐 blob으로
// 준비해 두었고, 이 command가 같은 transaction에서 그 blob의 영구 참조를 등록한다.
// 준비 증거는 같은 값에서 정해진다: 정규 직렬화의 hash·크기, 보낸 자격의
// principal, 본문 purpose. 살아 있는 준비가 없으면 등록이 거절되어 전체가 되돌아간다.

// 사람 메시지를 session의 입력함에 넣는 Router 입구다(`core/router`의 `route`가 이 모양을 만족한다).
// 같은 Tx 안에서 부르고, 실패하면 접수한 메시지도 함께 되돌아간다.
export type MessageRouter = {
  route(tx: Tx, input: {
    from: CallFrom;
    to: CallToInput | CallTo;
    reply: CallReply;
    body: string;
    refs: CallRef[];
    reply_to: null;
    dedup: null;
    options: null;
    kind: "message";
    delivery: InputDelivery;
    message: Id<"msg">;
  }): Result<{ session: string | null }>;
};

export type SendMessageDeps = {
  router: MessageRouter;
  // session의 받는 길과 `accepting`(archive나 place 보관이면 false)을 본다.
  directory: Pick<SessionDirectory, "find">;
};

function messageNotFound(): Result<never> {
  return reject("not_found", "message not found");
}

type BodyBlob = {
  hash: string;
  evidence: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  };
};

// 본문 값의 blob 증거. 준비한 쪽(core)과 같은 정규 직렬화를 쓰므로 같은 값은 항상
// 같은 hash다. 재전송의 지문도 값으로 정해져 준비 참조의 수명과 상관없다.
function bodyBlob(principal: string, content: unknown): BodyBlob {
  const bytes = serializeMessageContent(content);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    hash,
    evidence: {
      preparation: hash,
      principal,
      purpose: MESSAGE_CONTENT_PURPOSE,
      hash,
      size_bytes: bytes.length,
    },
  };
}

function registerBody(
  tx: Tx,
  message: string,
  seq: string,
  body: BodyBlob,
  existing?: PermanentBlobReference,
): Result<void> {
  const registered = tx.registerBlobRef({
    owner_kind: MESSAGE_BODY_OWNER_KIND,
    owner_key: message,
    field: MESSAGE_BODY_FIELD,
    registered_seq: seq,
    source: existing === undefined
      ? { kind: "prepared", blob: body.evidence }
      : { kind: "existing", reference: existing },
  });
  return registered.ok ? ok(undefined) : registered;
}

function insertMessage(
  tx: Tx,
  row: {
    id: string;
    session: string;
    actor: string;
    body: string;
    run: string | null;
    mode: string | null;
    links: string;
  },
  seq: string,
): void {
  tx.sql.run(
    `insert into messages (id, session, actor, body, run, mode,
       applied_at_call, links, created_seq, state_seq)
     values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)`,
    [
      row.id,
      row.session,
      row.actor,
      row.body,
      row.run,
      row.mode,
      row.links,
      Number(seq),
      Number(seq),
    ],
  );
}

export type ReceivedMessage = {
  message: ReturnType<typeof snapshotOf>["message"];
  created_seq: string;
  state_seq: string;
};

function stored(row: MessageRow | undefined): Result<ReceivedMessage> {
  return row === undefined ? messageNotFound() : ok(snapshotOf(row));
}

// 제목을 정하는 글. 글 part만 읽고 줄 구분은 줄바꿈이다.
function textOf(content: Input<typeof sendMessage>["content"]): string {
  return content.parts.flatMap((part) =>
    part.kind === "text" ? [part.text] : []
  )
    .join("\n");
}

// session에 machine이 남기는 사실 한 줄의 본문이다(Undo의 "Undid edit to <경로>"). core가 이 값으로 blob을
// 준비해 두고 recordFactMessage가 같은 값에서 같은 hash를 만든다.
export function factMessageContent(text: string) {
  return {
    schema_version: 1 as const,
    parts: [{ kind: "text" as const, text }],
  };
}

// 다른 command가 같은 transaction 안에서 session에 사실 메시지(machine, run 없음)를 남긴다. 본문 blob은
// principal의 이름으로 준비되어 있어야 한다. 열려 있는 session에만 남긴다.
export function recordFactMessage(
  tx: Tx,
  input: { session: string; text: string; principal: string },
): Result<string> {
  const session = loadSession(tx, input.session);
  if (session === undefined) return sessionNotFound();
  if (session.state !== "open") {
    return reject("forbidden", "a closed session takes no new message");
  }
  const content = factMessageContent(input.text);
  if (!textMessageContentInputSchema.safeParse(content).success) {
    return reject("invalid_input", "the fact message is not valid text");
  }
  const body = bodyBlob(input.principal, content);
  const id = tx.newId("msg");
  const seq = tx.emit(messageRecorded, id, {
    session: session.id,
    run: null,
    body: body.hash,
    links: [],
  });
  insertMessage(tx, {
    id,
    session: session.id,
    actor: "machine",
    body: body.hash,
    run: null,
    mode: null,
    links: "[]",
  }, seq);
  const registered = registerBody(tx, id, seq, body);
  return registered.ok ? ok(id) : registered;
}

// 이 session에 도는 turn이 있는지. steer가 도는 turn 안으로 들어가는지 가른다.
function hasRunningTurn(tx: Tx, session: string): boolean {
  return tx.sql.get(
    "select 1 as found from turns where session = ? and state = 'running'",
    [session],
  ) !== undefined;
}

// 접수한 메시지의 순서 칸이다. ledger event 없이 쓰므로 표 안에서 이어 센다.
function nextCreatedSeq(tx: Tx): number {
  const row = tx.sql.get(
    "select coalesce(max(created_seq), 0) + 1 as next from messages",
    [],
  );
  return row === undefined ? 1 : Number(row["next"]);
}

export type SentMessage = { message: string; state_seq: string };

type HumanMessage = {
  id: string;
  session: string;
  content: Input<typeof sendMessage>["content"];
  delivery: InputDelivery;
  refs: CallRef[];
};

// 사람 메시지를 session 기록에 쓴다. 입력함에 넣는 것(Router)은 부른 쪽이 한다. `existingBody`가 있으면 본문
// blob은 이미 저장되고 참조가 등록된 값이다(다른 concern이 사람 한 번의 요청에서 만든 요청; request.ts).
// 없으면 core가 준비한 blob의 준비 증거로 영구 참조를 등록한다. 같은 메시지를 다시 부르면 `replayed`다.
function writeHuman(
  tx: Tx,
  ctx: RequestContext,
  input: HumanMessage,
  existingBody: PermanentBlobReference | undefined,
): Result<{ replayed: boolean; text: string; state_seq: string }> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const text = textOf(input.content);
  const body = bodyBlob(ctx.principal, input.content);
  if (existingBody !== undefined && existingBody.hash !== body.hash) {
    return reject("invalid_input", "the stored body is not this content");
  }
  const existing = tx.sql.get(
    "select session, body, from_kind, created_seq from messages where id = ?",
    [input.id],
  );
  if (existing !== undefined) {
    const same = String(existing["session"]) === input.session &&
      String(existing["body"]) === body.hash &&
      String(existing["from_kind"]) === "human";
    return same
      ? ok({
        replayed: true,
        text,
        state_seq: String(existing["created_seq"]),
      })
      : reject("conflict", "message id already used for other input");
  }
  const session = loadSession(tx, input.session);
  if (session === undefined) return sessionNotFound();
  const firstRequest = tx.sql.get(
    `select 1 as found from messages
     where session = ? and from_kind = 'human' and delivery = 'next_turn'
     limit 1`,
    [session.id],
  ) === undefined;
  const seq = nextCreatedSeq(tx);
  tx.sql.run(
    `insert into messages (id, session, from_kind, from_ref, call, reply_to,
       refs, delivery, turn, body, created_seq, state_seq)
     values (?, ?, 'human', null, null, null, ?, ?, null, ?, ?, ?)`,
    [
      input.id,
      session.id,
      JSON.stringify(input.refs),
      input.delivery,
      body.hash,
      seq,
      seq,
    ],
  );
  const registered = registerBody(
    tx,
    input.id,
    String(seq),
    body,
    existingBody,
  );
  if (!registered.ok) return registered;
  // 도는 turn 안으로 들어간 steer는 checkpoint가 아니다. 새 사람 메시지가 접수되면 앞 rewind의 redo는
  // 확정(closed)된다.
  const mode = input.delivery === "steer" ? "correction" : "request";
  const checkpoint = createCheckpoint(tx, {
    id: input.id,
    session: session.id,
    actor: ctx.actor,
    mode,
    copied_from: null,
  });
  if (!checkpoint.ok) return checkpoint;
  const closed = closeAvailableRedo(tx, session.id);
  if (!closed.ok) return closed;
  // 제목은 첫 사람 request를 접수하는 같은 transaction에서 정한다. 상태 seq는 바꾸지 않는다: 바로 이어
  // 보낸 다음 입력이 낡은 seq로 충돌하지 않게 한다.
  const title = titleOnReceive({
    title: session.title,
    first_request: firstRequest,
    mode,
    text,
  });
  if (title !== session.title) {
    tx.sql.run("update sessions set title = ? where id = ?", [
      title,
      session.id,
    ]);
  }
  return ok({ replayed: false, text, state_seq: String(seq) });
}

// SendMessage의 본체. 사람 메시지는 접수할 때 session 기록에 쓰고 Router(`from: human`)를 거쳐 입력함에
// 들어간다. 입력함에 넣는 것이 실패하면 쓴 메시지도 같은 transaction이라 함께 되돌아간다.
export function sendWith(
  deps: SendMessageDeps,
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof sendMessage>,
  existingBody: PermanentBlobReference | undefined,
): Result<SentMessage> {
  // archive한 session과 보관한 place(project나 앱)의 session은 새 입력을 받지 않는다.
  const target = deps.directory.find(input.session as Id<"ses">);
  if (target === null) return sessionNotFound();
  if (!target.accepting) {
    return reject("conflict", "this session takes no new input");
  }
  // 도는 turn이 없으면 steer도 다음 turn의 입력이다.
  const delivery: InputDelivery =
    input.delivery === "steer" && hasRunningTurn(tx, input.session)
      ? "steer"
      : "next_turn";
  const written = writeHuman(tx, ctx, { ...input, delivery }, existingBody);
  if (!written.ok) return written;
  if (written.value.replayed) {
    return ok({ message: input.id, state_seq: written.value.state_seq });
  }
  const chips = attachedText(input.attached);
  const routed = deps.router.route(tx, {
    from: { kind: "human" },
    to: { session: input.session as Id<"ses"> },
    reply: "none",
    body: chips === "" ? written.value.text : `${chips}\n${written.value.text}`,
    refs: input.refs,
    reply_to: null,
    dedup: null,
    options: null,
    kind: "message",
    delivery,
    message: input.id as Id<"msg">,
  });
  if (!routed.ok) return routed;
  return ok({ message: input.id, state_seq: written.value.state_seq });
}

// 사람의 단추 한 번으로 새 session을 여는 요청이다(request.ts). Router가 session을 열고 입력을 넣은 뒤
// 그 session에 사람 메시지를 쓴다.
export function sendToNewSession(
  deps: Pick<SendMessageDeps, "router">,
  tx: Tx,
  ctx: RequestContext,
  input: {
    id: string;
    agent: CallAgent;
    content: Input<typeof sendMessage>["content"];
  },
  existingBody: PermanentBlobReference,
): Result<{ session: string; message: string }> {
  const routed = deps.router.route(tx, {
    from: { kind: "human" },
    to: { kind: "new_session", agent: input.agent },
    reply: "none",
    body: textOf(input.content),
    refs: [],
    reply_to: null,
    dedup: null,
    options: null,
    kind: "message",
    delivery: "next_turn",
    // 이 id로 곧 이어 쓴다(같은 transaction).
    message: input.id as Id<"msg">,
  });
  if (!routed.ok) return routed;
  if (routed.value.session === null) {
    return err({ code: "internal", message: "the request opened no session" });
  }
  const written = writeHuman(tx, ctx, {
    id: input.id,
    session: routed.value.session,
    content: input.content,
    delivery: "next_turn",
    refs: [],
  }, existingBody);
  if (!written.ok) return written;
  return ok({ session: routed.value.session, message: input.id });
}

export function createMessageCommands(deps: SendMessageDeps): {
  send: CommandDefinition<typeof sendMessage>;
  record: CommandDefinition<typeof recordMessage>;
  apply: CommandDefinition<typeof applyMessages>;
  assign: CommandDefinition<typeof assignMessage>;
} {
  return {
    send: {
      route: sendMessage,
      handle(tx, ctx, input: Input<typeof sendMessage>) {
        return sendWith(deps, tx, ctx, input, undefined);
      },
    },
    record: {
      route: recordMessage,
      handle(tx, ctx, input: Input<typeof recordMessage>) {
        const actor = parseActor(ctx.actor);
        if (actor?.kind !== "agent" && actor?.kind !== "machine") {
          return reject("forbidden", "only an agent or machine records");
        }
        const session = loadSession(tx, input.session);
        if (session === undefined || !sessionVisible(ctx, session)) {
          return sessionNotFound();
        }
        // agent 자격은 자기 run에 묶여 있다. 그 run의 답만 기록한다.
        if (actor.kind === "agent" && input.run !== ctx.run) {
          return reject("forbidden", "an agent records only for its own run");
        }
        // machine 확인은 글만 낸다. 시각 블록은 agent의 답에만 있다(MessageContent).
        if (
          actor.kind === "machine" &&
          !textMessageContentInputSchema.safeParse(input.content).success
        ) {
          return reject("invalid_input", "a machine message holds text only");
        }
        // 시각 블록의 markup·script·URL은 contract schema가 보지 않는다. 저장 전에 owner가 거절한다.
        if (actor.kind === "agent") {
          const checked = checkVisualContent(input.content);
          if (!checked.ok) {
            return reject("invalid_input", checked.error.message);
          }
        }
        const body = bodyBlob(ctx.principal, input.content);
        const links = JSON.stringify(input.links);
        const existing = loadMessage(tx, input.id);
        if (existing !== undefined) {
          const same = existing.actor === ctx.actor &&
            existing.session === input.session && existing.run === input.run &&
            existing.body === body.hash && existing.mode === null &&
            existing.copied_from === null &&
            sameLinks(existing.links, input.links);
          return same
            ? stored(existing)
            : reject("conflict", "message id already used for other input");
        }
        if (session.state !== "open") {
          return reject("forbidden", "a closed session takes no new message");
        }
        if (input.run !== null) {
          const run = loadRunRef(tx, input.run);
          if (
            run === undefined || run.session !== session.id ||
            run.assignment !== session.assignment
          ) {
            return reject(
              "invalid_input",
              "run does not belong to the session",
            );
          }
        }
        for (const link of input.links) {
          if (!linkExists(tx, link)) {
            return reject("invalid_input", "link target does not exist");
          }
        }
        const seq = tx.emit(messageRecorded, input.id, {
          session: session.id,
          run: input.run,
          body: body.hash,
          links: input.links,
        });
        insertMessage(tx, {
          id: input.id,
          session: session.id,
          actor: ctx.actor,
          body: body.hash,
          run: input.run,
          mode: null,
          links,
        }, seq);
        const registered = registerBody(tx, input.id, seq, body);
        if (!registered.ok) return registered;
        return stored(loadMessage(tx, input.id));
      },
    },
    apply: {
      route: applyMessages,
      // model call 시작과 같은 transaction에서 부를 수 있게 tx.call 대상으로 둔다.
      dispatchable: true,
      handle(tx, ctx, input: Input<typeof applyMessages>) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "applying is machine only");
        }
        const call = tx.sql.get("select run from model_calls where id = ?", [
          input.call,
        ]);
        if (call === undefined) {
          return reject("not_found", "model call not found");
        }
        const callRun = call["run"] === null ? null : String(call["run"]);
        const rows: MessageRow[] = [];
        for (const id of input.messages) {
          const row = loadMessage(tx, id);
          if (row === undefined) return messageNotFound();
          if (row.actor !== "user") {
            return reject("invalid_input", "only a person's input is applied");
          }
          if (row.run === null || row.run !== callRun) {
            return reject(
              "invalid_input",
              "the call does not belong to the run of the message",
            );
          }
          rows.push(row);
        }
        // 같은 call로 이미 반영한 재전송은 이전 결과다. 일부만 반영된 묶음은 충돌이다.
        const done = rows.filter((row) => row.applied_at_call !== null);
        if (done.length > 0) {
          const replay = done.length === rows.length &&
            done.every((row) => row.applied_at_call === input.call);
          return replay
            ? ok({ messages: rows.map(snapshotOf) })
            : reject("conflict", "a message was already applied");
        }
        for (const row of rows) {
          const seq = tx.emit(messageApplied, row.id, { call: input.call });
          tx.sql.run(
            "update messages set applied_at_call = ?, state_seq = ? where id = ?",
            [input.call, Number(seq), row.id],
          );
        }
        return ok({
          messages: rows.map((row) => snapshotOf(loadMessage(tx, row.id)!)),
        });
      },
    },
    assign: {
      route: assignMessage,
      handle(tx, ctx, input: Input<typeof assignMessage>, compare) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "assigning is machine only");
        }
        const message = loadMessage(tx, input.message);
        if (message === undefined) return messageNotFound();
        if (message.actor !== "user" || message.mode !== "correction") {
          return reject(
            "invalid_input",
            "only a correction moves; a request keeps its own run",
          );
        }
        // 같은 새 담당의 재전송은 이전 결과다.
        if (
          message.run === input.run && compare.previous_run !== input.run &&
          message.applied_at_call === null
        ) {
          return stored(message);
        }
        if (compare.previous_run === input.run) {
          return reject("invalid_input", "the new run is the previous run");
        }
        if (message.applied_at_call !== null) {
          return reject("conflict", "the message was already applied");
        }
        if (
          message.run !== compare.previous_run ||
          message.state_seq !== compare.message_state_seq
        ) {
          return reject("conflict", "message changed");
        }
        const run = loadRunRef(tx, input.run);
        if (run === undefined) return reject("not_found", "run not found");
        if (run.session !== message.session) {
          return reject("invalid_input", "run belongs to another session");
        }
        if (run.state === "finished") {
          return reject("conflict", "the new run is already finished");
        }
        const seq = tx.emit(messageAssigned, message.id, {
          previous_run: message.run,
          run: run.id,
        });
        tx.sql.run("update messages set run = ?, state_seq = ? where id = ?", [
          run.id,
          Number(seq),
          message.id,
        ]);
        return stored(loadMessage(tx, message.id));
      },
    },
  };
}
