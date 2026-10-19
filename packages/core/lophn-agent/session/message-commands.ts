import { createHash } from "node:crypto";
import { ok, type Result } from "../../../base/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_PURPOSE,
  recordMessage,
  sendMessage,
  serializeMessageContent,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
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
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { SessionDirectory } from "../../router/ports.ts";
import { attachedText } from "../run-loop/input-text.ts";
import type { PermanentBlobReference } from "../../../protocol/storage/mod.ts";
import { createCheckpoint, hiddenRanges, inHiddenRange } from "./rewind/mod.ts";
import { reject, requireUser, sessionNotFound } from "./guards.ts";
import { loadSession } from "./model.ts";
import { titleOnReceive } from "./session-title.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. 같은 ID의 재전송은 내용이 같으면 이전
// 결과, 다르면 conflict다. 본문은 값으로 받는다. core가 redaction을 거쳐 blob으로
// 준비해 두었고, 이 command가 같은 transaction에서 그 blob의 영구 참조를 등록한다.
// 준비 증거는 같은 값에서 정해진다: 정규 직렬화의 hash·크기, 보낸 자격의
// principal, 본문 purpose. 살아 있는 준비가 없으면 등록이 거절되어 전체가 되돌아간다.

// 사람 메시지를 session의 입력함에 넣는 Router 입구다(`core/router`의 `route`가 이 모양을 만족한다).
// 같은 Tx 안에서 부르고, 실패하면 접수한 메시지도 함께 되돌아간다.
type MessageRouter = {
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
  directory: {
    find(tx: Tx, session: Id<"ses">): ReturnType<SessionDirectory["find"]>;
  };
};

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

// 제목을 정하는 글. 글 part만 읽고 줄 구분은 줄바꿈이다.
function textOf(content: Input<typeof sendMessage>["content"]): string {
  return content.parts.flatMap((part) =>
    part.kind === "text" ? [part.text] : []
  )
    .join("\n");
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

type SentMessage = { message: string; state_seq: string };

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
       refs, delivery, turn, body, created_seq, created_at, state_seq)
     values (?, ?, 'human', null, null, null, ?, ?, null, ?, ?, ?, ?)`,
    [
      input.id,
      session.id,
      JSON.stringify(input.refs),
      input.delivery,
      body.hash,
      seq,
      tx.now(),
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
  // 도는 turn 안으로 들어간 steer는 checkpoint가 아니다.
  const checkpoint = createCheckpoint(tx, {
    id: input.id,
    session: session.id,
    from_kind: "human",
    delivery: input.delivery,
    copied_from: null,
  });
  if (!checkpoint.ok) return checkpoint;
  // 제목은 첫 사람 request를 접수하는 같은 transaction에서 정한다. 상태 seq는 바꾸지 않는다: 바로 이어
  // 보낸 다음 입력이 낡은 seq로 충돌하지 않게 한다.
  const title = titleOnReceive({
    title: session.title,
    first_request: firstRequest,
    delivery: input.delivery === "steer" ? "steer" : "next_turn",
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
function sendWith(
  deps: SendMessageDeps,
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof sendMessage>,
  existingBody: PermanentBlobReference | undefined,
): Result<SentMessage> {
  // archive한 session과 보관한 place(project)의 session은 새 입력을 받지 않는다.
  const target = deps.directory.find(tx, input.session as Id<"ses">);
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

// core를 켤 때 입력함에 되돌려 놓을 사람 메시지다. 입력함은 메모리라 꺼지면 사라지는데, 아직 turn이 가져가지 않은
// 접수 기록은 남는다. 접수 순서로 돌려준다. Fork 복사본도 turn이 비어 있어서, Fork한 session은 자기 turn이 가져간
// 마지막 메시지보다 뒤에 접수한 것만 센다. rewind가 숨긴 구간의 메시지는 뺀다.
export function unstartedHumanMessages(
  sql: Pick<Sql, "get" | "all">,
): { id: string; session: string; refs: CallRef[]; created_at: string }[] {
  const rows = sql.all(
    `select m.id, m.session, m.refs, m.created_at, m.created_seq
     from messages m join sessions s on s.id = m.session
     where m.from_kind = 'human' and m.turn is null and s.lifecycle = 'open'
       and (s.forked_from_session is null or m.created_seq > (
         select max(c.created_seq) from messages c
         where c.session = s.id and c.turn is not null))
     order by m.created_seq`,
    [],
  );
  const hidden = new Map<string, ReturnType<typeof hiddenRanges>>();
  return rows.filter((row) => {
    const session = String(row["session"]);
    if (!hidden.has(session)) {
      hidden.set(session, hiddenRanges({ sql }, session));
    }
    return !inHiddenRange(hidden.get(session)!, String(row["created_seq"]));
  }).map((row) => ({
    id: String(row["id"]),
    session: String(row["session"]),
    refs: JSON.parse(String(row["refs"])) as CallRef[],
    created_at: String(row["created_at"]),
  }));
}

// 사람의 단추 한 번으로 새 session을 여는 요청이다(request.ts). Router가 session을 열고 입력을 넣은 뒤
// 그 session에 사람 메시지를 쓴다.

// agent의 답을 그 session의 기록에 남긴다. 받은 메시지와 같은 봉투로 쓴다: 보낸 쪽은 그 session 자신이고
// `turn`은 답한 turn이다. 쓰는 쪽은 runtime(machine)이거나 그 session 자신의 agent이고, turn은 이 session에서
// 도는 중이어야 한다. 같은 메시지를 다시 부르면 이전 결과다. 입력함에는 넣지 않는다: 답은 자기 session의 입력이
// 아니다.
function recordAgent(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof recordMessage>,
): Result<{ message: string; state_seq: string }> {
  const actor = parseActor(ctx.actor);
  const allowed = actor?.kind === "machine" ||
    (actor?.kind === "agent" && actor.id === input.session);
  if (!allowed) {
    return reject(
      "forbidden",
      "only the session's own agent records its reply",
    );
  }
  const turn = tx.sql.get("select session, state from turns where id = ?", [
    input.turn,
  ]);
  if (turn === undefined || String(turn["session"]) !== input.session) {
    return reject("not_found", "turn not found");
  }
  const body = bodyBlob(ctx.principal, input.content);
  const existing = tx.sql.get(
    `select session, body, from_kind, from_ref, turn, created_seq
     from messages where id = ?`,
    [input.id],
  );
  if (existing !== undefined) {
    const same = String(existing["session"]) === input.session &&
      String(existing["body"]) === body.hash &&
      String(existing["from_kind"]) === "agent" &&
      String(existing["from_ref"]) === input.session &&
      String(existing["turn"]) === input.turn;
    return same
      ? ok({ message: input.id, state_seq: String(existing["created_seq"]) })
      : reject("conflict", "message id already used for other input");
  }
  if (String(turn["state"]) !== "running") {
    return reject("conflict", "the turn is finished");
  }
  if (loadSession(tx, input.session) === undefined) return sessionNotFound();
  const seq = nextCreatedSeq(tx);
  tx.sql.run(
    `insert into messages (id, session, from_kind, from_ref, call, reply_to,
       refs, delivery, turn, body, created_seq, created_at, state_seq)
     values (?, ?, 'agent', ?, null, null, '[]', 'next_turn', ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.session,
      input.session,
      input.turn,
      body.hash,
      seq,
      tx.now(),
      seq,
    ],
  );
  const registered = registerBody(tx, input.id, String(seq), body);
  if (!registered.ok) return registered;
  return ok({ message: input.id, state_seq: String(seq) });
}

export function createMessageCommands(deps: SendMessageDeps): {
  send: CommandDefinition<typeof sendMessage>;
  record: CommandDefinition<typeof recordMessage>;
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
      handle: (tx, ctx, input: Input<typeof recordMessage>) =>
        recordAgent(tx, ctx, input),
    },
  };
}
