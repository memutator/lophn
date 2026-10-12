import { canonicalize, ok, type Result } from "../../base/mod.ts";
import {
  type applyMessages,
  archiveSession,
  type assignMessage,
  changeSessionModel,
  closeSession,
  type compactSession,
  deleteSession,
  type failSessionCompact,
  type forkSession,
  MESSAGE_BODY_OWNER_KIND,
  openSession,
  type receiveMessage,
  type recordMessage,
  renameSession,
  type requestSessionCompact,
  sessionArchived,
  sessionClosed,
  sessionDeleted,
  sessionModelChanged,
  sessionOpened,
  sessionRenamed,
  sessionUnarchived,
  unarchiveSession,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  parseActor,
  type PermanentBlobReference,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { createCompactCommands } from "./compact.ts";
import { createForkCommand } from "./fork.ts";
import { deleteSessionReverts } from "../revert/mod.ts";
import { reject, requireUser, sessionNotFound } from "./guards.ts";
import { type AcceptRun, createMessageCommands } from "./message-commands.ts";
import {
  type AssignmentRef,
  eventExists,
  hasUnfinishedRun,
  loadAssignmentRef,
  loadSession,
  modelSelectionOf,
  type SessionRow,
  targetIsActive,
  workPlaceOf,
} from "./model.ts";
import { checkSessionModel } from "./session-model.ts";
import { renameSessionTitle } from "./session-title.ts";

// 세션 command. 등록 순서와 transaction 규칙은 message-commands.ts와 같다.

export type ConversationDeps = {
  // 같은 Tx에서 run을 접수한다(run-loop AcceptRun). 사람 입력 접수와 담당 run 접수는
  // 한 transaction이어야 한다(R3, R7). 조립이 run-loop의 accept handler를 건다.
  acceptRun: AcceptRun;
  // 세션을 지울 때 같은 Tx에서 그 세션의 run 기록을 지운다(R20). 기록을 가진 concern마다
  // 자기 몫을 지우고 조립이 그것들을 잇는다. 메시지는 이 함수를 부르기 전에 지워져 있다.
  deleteSessionRecords: (tx: Tx, session: string) => Result<void>;
  // 메시지 본문의 blob 영구 참조를 지운다(platform/blob-store). 소유 행인 메시지보다 먼저 부른다.
  eraseBlobRefs: (
    tx: Tx,
    ownerKind: string,
    ownerKeys: readonly string[],
  ) => Result<void>;
};

type PlaceInput = { kind: "project" | "app"; id: string };

// 자리가 role 규칙에 맞는 active project나 app인지(R1, R16). App Engineer와 Operator는
// 담당 범위와 같은 자리, Context Engineer는 project, lophn은 project나 app이다.
function checkPlace(
  tx: Tx,
  assignment: AssignmentRef,
  place: PlaceInput,
): Result<void> {
  if (assignment.role === "app_engineer" || assignment.role === "operator") {
    if (
      place.kind !== assignment.scope_kind || place.id !== assignment.scope_id
    ) {
      return reject(
        "forbidden",
        "the work place is fixed to the assignment scope",
      );
    }
  } else if (
    assignment.role === "context_engineer" && place.kind !== "project"
  ) {
    return reject("forbidden", "a Context Engineer works in a project");
  }
  return targetIsActive(tx, place.kind, place.id)
    ? ok(undefined)
    : reject("not_found", "work place target not found");
}

function sameOpening(
  row: SessionRow,
  opening: { source_seq: string; target: string } | null,
): boolean {
  return opening === null
    ? row.opening_source_seq === null
    : row.opening_source_seq === opening.source_seq &&
      row.opening_target === opening.target;
}

function openedOf(row: SessionRow) {
  return {
    id: row.id,
    state: "open" as const,
    work_place: workPlaceOf(row),
    state_seq: row.state_seq,
  };
}

// archive는 목록 표시만 바꾼다(R19). 이미 그 상태면 이전 결과이고, 낡은 seq의 재전송도 같은
// 결과를 받는다. 닫힌 세션도 archive를 바꿀 수 있다.
function toggleArchived(
  tx: Tx,
  ctx: RequestContext,
<<<<<<< HEAD
  session: string,
  stateSeq: string,
  archived: boolean,
): Result<{ id: string; state_seq: string }> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const row = loadSession(tx, session);
  if (row === undefined) return sessionNotFound();
  if (row.archived === archived) {
    return ok({ id: row.id, state_seq: row.state_seq });
  }
  if (row.state_seq !== stateSeq) return reject("conflict", "session changed");
  const seq = tx.emit(
    archived ? sessionArchived : sessionUnarchived,
    row.id,
    {},
  );
  tx.sql.run("update sessions set archived = ?, state_seq = ? where id = ?", [
    archived ? 1 : 0,
    Number(seq),
    row.id,
  ]);
  return ok({ id: row.id, state_seq: seq });
=======
  deps: ConversationDeps,
  session: SessionRow,
  assignment: AssignmentRef,
  message: string,
): Result<string> {
  const run = tx.newId("run");
  const accepted = deps.acceptRun(tx, ctx, {
    id: run,
    assignment: session.assignment,
    session: session.id,
    source: { kind: "message", message },
    continued_from: null,
    start_after: latestSessionRun(tx, session.id),
  }, { assignment_revision: assignment.revision });
  return accepted.ok ? ok(run) : accepted;
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
function bodyBlob(ctx: RequestContext, content: unknown): BodyBlob {
  const bytes = serializeMessageContent(content);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    hash,
    evidence: {
      preparation: hash,
      principal: ctx.principal,
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
>>>>>>> origin/main
}

// ReceiveMessage의 본체. `existingBody`가 있으면 본문 blob은 이미 저장되고 참조가 등록된 값이다(다른
// concern이 사람 한 번의 요청에서 만든 요청; request.ts). 없으면 core가 준비한 blob의 준비 증거로
// 영구 참조를 등록한다.
export function receiveWith(
  deps: ConversationDeps,
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof receiveMessage>,
  compare: Compare<typeof receiveMessage>,
  existingBody: PermanentBlobReference | undefined,
): Result<ReceivedMessage> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const body = bodyBlob(ctx, input.content);
  if (existingBody !== undefined && existingBody.hash !== body.hash) {
    return reject("invalid_input", "the stored body is not this content");
  }
  const existing = loadMessage(tx, input.id);
  if (existing !== undefined) {
    const target = existing.run === null
      ? undefined
      : loadRunRef(tx, existing.run);
    const same = existing.actor === "user" &&
      existing.session === input.session &&
      existing.body === body.hash && existing.mode === input.mode &&
      (input.mode === "request"
        ? input.run === undefined
        : existing.run === input.run ||
          target?.source_message === existing.id);
    return same
      ? stored(existing)
      : reject("conflict", "message id already used for other input");
  }
  const session = loadSession(tx, input.session);
  if (session === undefined) return sessionNotFound();
  if (session.state !== "open") {
    return reject("forbidden", "a closed session takes no new input");
  }
  const assignment = loadAssignmentRef(tx, session.assignment);
  if (assignment === undefined) {
    return reject("not_found", "assignment not found");
  }
  if (assignment.state === "withdrawn") {
    return reject("forbidden", "a withdrawn assignment takes no input");
  }
  if (
    session.state_seq !== compare.session_state_seq ||
    assignment.revision !== compare.assignment_revision ||
    assignment.state !== compare.assignment_state
  ) {
    return reject("conflict", "session or assignment changed");
  }
  let run: string | null;
  if (input.mode === "correction") {
    if (assignment.state !== "enabled") {
      return reject(
        "forbidden",
        "a correction is taken only while the assignment is enabled",
      );
    }
    const target = loadRunRef(tx, input.run as string);
    if (
      target === undefined || target.session !== session.id ||
      target.assignment !== session.assignment
    ) return reject("not_found", "run not found");
    if (target.state !== "finished") {
      run = target.id;
    } else {
      // 종료가 확정된 뒤에 온 수정은 끝난 run을 다시 열지 않고 새 담당 run에
      // 접수한다(R7). 같은 transaction이라 담당은 정확히 하나다.
      const accepted = acceptForMessage(
        tx,
        ctx,
        deps,
        session,
        assignment,
        input.id,
      );
      if (!accepted.ok) return accepted;
      run = accepted.value;
    }
  } else if (input.run !== undefined) {
    return reject("invalid_input", "a next request names no target run");
  } else if (assignment.state === "paused") {
    // paused에서는 원문만 담당 run 없이 보존한다(R14).
    run = null;
  } else {
    const accepted = acceptForMessage(
      tx,
      ctx,
      deps,
      session,
      assignment,
      input.id,
    );
    if (!accepted.ok) return accepted;
    run = accepted.value;
  }
  const seq = tx.emit(messageReceived, input.id, {
    session: session.id,
    run,
    mode: input.mode,
    body: body.hash,
  });
  insertMessage(tx, {
    id: input.id,
    session: session.id,
    actor: ctx.actor,
    body: body.hash,
    run,
    mode: input.mode,
    links: "[]",
  }, seq);
  const registered = registerBody(tx, input.id, seq, body, existingBody);
  if (!registered.ok) return registered;
  return stored(loadMessage(tx, input.id));
}

export function createConversationCommands(deps: ConversationDeps): {
  open: CommandDefinition<typeof openSession>;
  rename: CommandDefinition<typeof renameSession>;
  archive: CommandDefinition<typeof archiveSession>;
  unarchive: CommandDefinition<typeof unarchiveSession>;
  delete: CommandDefinition<typeof deleteSession>;
  changeModel: CommandDefinition<typeof changeSessionModel>;
  fork: CommandDefinition<typeof forkSession>;
  requestCompact: CommandDefinition<typeof requestSessionCompact>;
  compact: CommandDefinition<typeof compactSession>;
  failCompact: CommandDefinition<typeof failSessionCompact>;
  close: CommandDefinition<typeof closeSession>;
  receive: CommandDefinition<typeof receiveMessage>;
  record: CommandDefinition<typeof recordMessage>;
  apply: CommandDefinition<typeof applyMessages>;
  assign: CommandDefinition<typeof assignMessage>;
} {
  return {
    ...createMessageCommands(deps.acceptRun),
    fork: createForkCommand(),
    ...createCompactCommands(),
    open: {
      route: openSession,
      handle(
        tx,
        ctx: RequestContext,
        input: Input<typeof openSession>,
        compare,
      ) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const existing = loadSession(tx, input.id);
        if (existing !== undefined) {
          const same = existing.assignment === input.assignment &&
            existing.work_place_kind === input.work_place.kind &&
            existing.work_place_id === input.work_place.id &&
            sameOpening(existing, input.opening_context);
          if (!same) return reject("conflict", "session id already used");
          if (existing.state !== "open") {
            return reject("conflict", "session changed since it was opened");
          }
          return ok(openedOf(existing));
        }
        const assignment = loadAssignmentRef(tx, input.assignment);
        if (assignment === undefined) {
          return reject("not_found", "assignment not found");
        }
        // 멈춘 assignment(대상 보관)와 회수된 assignment는 새 세션을 받지 않는다.
        if (assignment.state !== "enabled") {
          return reject(
            "forbidden",
            "only an enabled assignment takes a session",
          );
        }
        if (assignment.revision !== compare.assignment_revision) {
          return reject("conflict", "assignment changed");
        }
        const place = checkPlace(tx, assignment, input.work_place);
        if (!place.ok) return place;
        const opening = input.opening_context;
        if (opening !== null && !eventExists(tx, opening.source_seq)) {
          return reject(
            "not_found",
            "the event of the opening context not found",
          );
        }
        const seq = tx.emit(sessionOpened, input.id, {
          assignment: input.assignment,
          work_place: input.work_place,
          opening_context: opening,
        });
        tx.sql.run(
          `insert into sessions (id, assignment, work_place_kind, work_place_id,
             state, opening_source_seq, opening_target, created_seq, state_seq)
           values (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
          [
            input.id,
            input.assignment,
            input.work_place.kind,
            input.work_place.id,
            opening === null ? null : BigInt(opening.source_seq),
            opening === null ? null : opening.target,
            Number(seq),
            Number(seq),
          ],
        );
        return ok({
          id: input.id,
          state: "open" as const,
          work_place: input.work_place,
          state_seq: seq,
        });
      },
    },
    rename: {
      route: renameSession,
      handle(tx, ctx, input: Input<typeof renameSession>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        const title = renameSessionTitle(input.title);
        if (!title.ok) return title;
        // 같은 제목이면 이전 결과다. 닫힌 세션도 이름을 바꾼다(R18).
        if (session.title === title.value) {
          return ok({
            id: session.id,
            title: title.value,
            state_seq: session.state_seq,
          });
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        const seq = tx.emit(sessionRenamed, session.id, {
          before: session.title,
          after: title.value,
        });
        tx.sql.run(
          "update sessions set title = ?, state_seq = ? where id = ?",
          [
            title.value,
            Number(seq),
            session.id,
          ],
        );
        return ok({ id: session.id, title: title.value, state_seq: seq });
      },
    },
    archive: {
      route: archiveSession,
      handle(tx, ctx, input: Input<typeof archiveSession>, compare) {
        const toggled = toggleArchived(
          tx,
          ctx,
          input.session,
          compare.state_seq,
          true,
        );
        return toggled.ok
          ? ok({ ...toggled.value, archived: true as const })
          : toggled;
      },
    },
    unarchive: {
      route: unarchiveSession,
      handle(tx, ctx, input: Input<typeof unarchiveSession>, compare) {
        const toggled = toggleArchived(
          tx,
          ctx,
          input.session,
          compare.state_seq,
          false,
        );
        return toggled.ok
          ? ok({ ...toggled.value, archived: false as const })
          : toggled;
      },
    },
    delete: {
      route: deleteSession,
      handle(tx, ctx, input: Input<typeof deleteSession>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        // 진행 중이거나 기다리는 run이 있으면 먼저 멈춘 뒤에만 지운다(R20).
        if (hasUnfinishedRun(tx, session.id)) {
          return reject("conflict", "a run of the session is not finished");
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        const bodies = deps.eraseBlobRefs(
          tx,
          MESSAGE_BODY_OWNER_KIND,
          tx.sql.all("select id from messages where session = ?", [session.id])
            .map((row) => String(row["id"])),
        );
        if (!bodies.ok) return bodies;
        // checkpoint와 되돌리기 기록이 메시지를 가리키므로 메시지보다 먼저 지운다.
        const rewound = deleteSessionReverts(tx, session.id);
        if (!rewound.ok) return rewound;
        tx.sql.run("delete from messages where session = ?", [session.id]);
        const erased = deps.deleteSessionRecords(tx, session.id);
        if (!erased.ok) return erased;
        tx.sql.run("delete from session_compact_requests where session = ?", [
          session.id,
        ]);
        tx.sql.run("delete from sessions where id = ?", [session.id]);
        const deletedAt = tx.now();
        tx.emit(sessionDeleted, session.id, {
          assignment: session.assignment,
          deleted_at: deletedAt,
        });
        return ok({ id: session.id, deleted_at: deletedAt });
      },
    },
    changeModel: {
      route: changeSessionModel,
      handle(tx, ctx, input: Input<typeof changeSessionModel>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (session.state !== "open") {
          return reject("conflict", "the session is closed");
        }
        const before = modelSelectionOf(session);
        // 같은 선택이면 이전 결과다.
        if (canonicalize(before) === canonicalize(input.model)) {
          return ok({
            id: session.id,
            model_selection: before,
            state_seq: session.state_seq,
          });
        }
        // null은 agent 기본값으로 돌아가는 것이라 검사할 선택이 없다.
        if (input.model !== null) {
          const checked = checkSessionModel(tx, input.model);
          if (!checked.ok) return checked;
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        const seq = tx.emit(sessionModelChanged, session.id, {
          before,
          after: input.model,
        });
        tx.sql.run(
          "update sessions set model_selection = ?, state_seq = ? where id = ?",
          [
            input.model === null ? null : canonicalize(input.model),
            Number(seq),
            session.id,
          ],
        );
        return ok({
          id: session.id,
          model_selection: input.model,
          state_seq: seq,
        });
      },
    },
    close: {
      route: closeSession,
      handle(tx, ctx, input: Input<typeof closeSession>, compare) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return reject("forbidden", "only the machine closes a session");
        }
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        // 닫는 길은 assignment 회수 하나다(R8).
        const assignment = loadAssignmentRef(tx, session.assignment);
        if (assignment?.state !== "withdrawn") {
          return reject("forbidden", "the assignment is not withdrawn");
        }
        if (session.state !== "open") {
          return reject("conflict", "the session is already closed");
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        // 미종료 run과 대기 요청을 먼저 정리해야 닫는다(R8).
        if (hasUnfinishedRun(tx, session.id)) {
          return reject("conflict", "a run of the session is not finished");
        }
        const closedAt = tx.now();
        const seq = tx.emit(sessionClosed, session.id, {
          reason: input.reason,
          closed_at: closedAt,
        });
        tx.sql.run(
          `update sessions set state = 'closed', closed_reason = ?,
             closed_at = ?, state_seq = ? where id = ?`,
          [input.reason, closedAt, Number(seq), session.id],
        );
        return ok({
          id: session.id,
          state: "closed" as const,
          reason: input.reason,
          closed_at: closedAt,
          state_seq: seq,
        });
      },
    },
<<<<<<< HEAD
=======
    receive: {
      route: receiveMessage,
      handle(tx, ctx, input: Input<typeof receiveMessage>, compare) {
        return receiveWith(deps, tx, ctx, input, compare, undefined);
      },
    },
    executeStored: {
      route: executeStoredRequest,
      handle(tx, ctx, input: Input<typeof executeStoredRequest>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const message = loadMessage(tx, input.message);
        if (message === undefined) return messageNotFound();
        if (message.run !== null) {
          // 같은 선택의 재전송은 같은 담당 결과다. 다른 담당이면 충돌이다.
          const owner = loadRunRef(tx, message.run);
          return owner?.source_message === message.id
            ? stored(message)
            : reject("conflict", "the message already has another run");
        }
        if (message.actor !== "user" || message.mode !== "request") {
          return reject("invalid_input", "only a preserved request runs");
        }
        if (message.applied_at_call !== null) {
          return reject("conflict", "the message was already applied");
        }
        const session = loadSession(tx, message.session);
        if (session === undefined) return sessionNotFound();
        const assignment = loadAssignmentRef(tx, session.assignment);
        if (assignment === undefined) {
          return reject("not_found", "assignment not found");
        }
        if (session.state !== "open" || assignment.state !== "enabled") {
          return reject(
            "forbidden",
            "run it while the session is open and the assignment is enabled",
          );
        }
        if (
          session.state_seq !== compare.session_state_seq ||
          message.state_seq !== compare.message_state_seq ||
          assignment.revision !== compare.assignment_revision
        ) {
          return reject("conflict", "message, session or assignment changed");
        }
        const accepted = acceptForMessage(
          tx,
          ctx,
          deps,
          session,
          assignment,
          message.id,
        );
        if (!accepted.ok) return accepted;
        const seq = tx.emit(messageAssigned, message.id, {
          previous_run: null,
          run: accepted.value,
        });
        tx.sql.run("update messages set run = ?, state_seq = ? where id = ?", [
          accepted.value,
          Number(seq),
          message.id,
        ]);
        return stored(loadMessage(tx, message.id));
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
        if (session === undefined || !visibleSession(ctx, session)) {
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
        const body = bodyBlob(ctx, input.content);
        const links = JSON.stringify(input.links);
        const existing = loadMessage(tx, input.id);
        if (existing !== undefined) {
          const same = existing.actor === ctx.actor &&
            existing.session === input.session && existing.run === input.run &&
            existing.body === body.hash && existing.mode === null &&
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
            "only a correction moves; a preserved request runs by a person",
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
>>>>>>> origin/main
  };
}
