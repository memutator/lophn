import { createHash } from "node:crypto";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type acceptRun,
  applyMessages,
  assignMessage,
  changeSessionWorkPlace,
  closeSession,
  executeStoredRequest,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_CONTENT_PURPOSE,
  messageApplied,
  messageAssigned,
  messageReceived,
  messageRecorded,
  openSession,
  receiveMessage,
  recordMessage,
  serializeMessageContent,
  sessionClosed,
  sessionOpened,
  sessionWorkPlaceChanged,
  textMessageContentInputSchema,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type CommandDefinition,
  type Compare,
  type Input,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  type AssignmentRef,
  latestSessionRun,
  linkExists,
  loadAssignmentRef,
  loadMessage,
  loadRunRef,
  loadSession,
  type MessageRow,
  sameLinks,
  type SessionRow,
  snapshotOf,
  targetIsActive,
  workPlaceOf,
} from "./model.ts";

// 등록 순서: 입력 검사 → 상태 재검사 → CAS 비교 → 쓰기 → event. 짧은 transaction
// 하나다. 실패하면 이전 판 전체가 유지된다. 같은 ID의 재전송은 내용이 같으면 이전
// 결과, 다르면 conflict다(R2). 본문은 값으로 받는다. core가 redaction을 거쳐 blob으로
// 준비해 두었고, 이 command가 같은 transaction에서 그 blob의 영구 참조를 등록한다
// (Q29). 준비 증거는 같은 값에서 정해진다: 정규 직렬화의 hash·크기, 보낸 자격의
// principal, 본문 purpose. 살아 있는 준비가 없으면 등록이 거절되어 전체가 되돌아간다.

export type ConversationDeps = {
  // 같은 Tx에서 run을 접수한다(run-loop AcceptRun). 사람 입력 접수와 담당 run 접수는
  // 한 transaction이어야 한다(R3, R7). 조립이 run-loop의 accept handler를 건다.
  acceptRun: (
    tx: Tx,
    ctx: RequestContext,
    input: Input<typeof acceptRun>,
    compare: Compare<typeof acceptRun>,
  ) => Result<unknown>;
};

type Code = "invalid_input" | "conflict" | "not_found" | "forbidden";

function reject(code: Code, message: string): Result<never> {
  return err({ code, message });
}

function sessionNotFound(): Result<never> {
  return reject("not_found", "session not found");
}

function messageNotFound(): Result<never> {
  return reject("not_found", "message not found");
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : reject(
    "forbidden",
    "only a person does this",
  );
}

// agent 자격은 자기 assignment의 세션만 본다. 그 밖은 없는 세션과 똑같이 답한다.
// coding_agent·app은 세션을 다루지 않는다.
function visibleSession(ctx: RequestContext, session: SessionRow): boolean {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return false;
  if (actor.kind === "user" || actor.kind === "machine") return true;
  return actor.kind === "agent" && actor.id === session.assignment;
}

function placeOf(row: SessionRow) {
  return workPlaceOf(row);
}

type WorkPlaceInput = { kind: "global" | "project" | "app"; id: string | null };

// AE·Operator는 assignment 범위와 같은 자리만, lophn·CE는 전역 또는 실제 쓸 수
// 있는 project·app만 받는다(R1, R16, R17).
function checkPlace(
  tx: Tx,
  assignment: AssignmentRef,
  place: WorkPlaceInput,
): Result<void> {
  if (assignment.role === "app_engineer" || assignment.role === "operator") {
    const same = place.kind === assignment.scope_kind &&
      place.id === assignment.scope_id;
    return same ? ok(undefined) : reject(
      "forbidden",
      "the work place is fixed to the assignment scope",
    );
  }
  if (place.kind === "global") return ok(undefined);
  if (place.id === null || !targetIsActive(tx, place.kind, place.id)) {
    return reject("not_found", "work place target not found");
  }
  return ok(undefined);
}

function sameContinuation(
  row: SessionRow,
  input: Input<typeof openSession>,
): boolean {
  const from = input.continued_from;
  if (from === null) return row.continued_from_session === null;
  return row.continued_from_session === from.session &&
    row.continued_from_through_seq === from.through_seq;
}

function acceptForMessage(
  tx: Tx,
  ctx: RequestContext,
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
): Result<void> {
  const registered = tx.registerBlobRef({
    owner_kind: MESSAGE_BODY_OWNER_KIND,
    owner_key: message,
    field: MESSAGE_BODY_FIELD,
    registered_seq: seq,
    source: { kind: "prepared", blob: body.evidence },
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

function stored(row: MessageRow | undefined): Result<{
  message: ReturnType<typeof snapshotOf>["message"];
  created_seq: string;
  state_seq: string;
}> {
  return row === undefined ? messageNotFound() : ok(snapshotOf(row));
}

export function createConversationCommands(deps: ConversationDeps): {
  open: CommandDefinition<typeof openSession>;
  changeWorkPlace: CommandDefinition<typeof changeSessionWorkPlace>;
  close: CommandDefinition<typeof closeSession>;
  receive: CommandDefinition<typeof receiveMessage>;
  executeStored: CommandDefinition<typeof executeStoredRequest>;
  record: CommandDefinition<typeof recordMessage>;
  apply: CommandDefinition<typeof applyMessages>;
  assign: CommandDefinition<typeof assignMessage>;
} {
  return {
    open: {
      route: openSession,
      handle(tx, ctx, input: Input<typeof openSession>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const existing = loadSession(tx, input.id);
        if (existing !== undefined) {
          const same = existing.assignment === input.assignment &&
            existing.role === input.role && sameContinuation(existing, input) &&
            (existing.work_place_revision > 1 ||
              (existing.work_place_kind === input.work_place.kind &&
                existing.work_place_id === input.work_place.id));
          if (!same) return reject("conflict", "session id already used");
          if (existing.state !== "open" || existing.work_place_revision !== 1) {
            return reject("conflict", "session changed since it was opened");
          }
          return ok({
            id: existing.id,
            state: "open" as const,
            work_place: placeOf(existing),
            work_place_revision: 1 as const,
            state_seq: existing.state_seq,
          });
        }
        const assignment = loadAssignmentRef(tx, input.assignment);
        if (assignment === undefined) {
          return reject("not_found", "assignment not found");
        }
        if (assignment.state === "withdrawn") {
          return reject("forbidden", "a withdrawn assignment takes no session");
        }
        if (assignment.role !== input.role) {
          return reject("invalid_input", "role does not match the assignment");
        }
        if (assignment.revision !== compare.assignment_revision) {
          return reject("conflict", "assignment changed");
        }
        if (assignment.state !== compare.assignment_state) {
          return reject("conflict", "assignment state changed");
        }
        const place = checkPlace(tx, assignment, input.work_place);
        if (!place.ok) return place;
        const from = input.continued_from;
        if (from !== null) {
          const source = loadSession(tx, from.session);
          if (source === undefined || source.assignment !== input.assignment) {
            return reject("not_found", "continuation source not found");
          }
          const anchor = tx.sql.get(
            "select 1 as found from messages where session = ? and created_seq = ?",
            [source.id, BigInt(from.through_seq)],
          );
          if (anchor === undefined) {
            return reject(
              "invalid_input",
              "continuation point is not a message of the source session",
            );
          }
        }
        const seq = tx.emit(sessionOpened, input.id, {
          assignment: input.assignment,
          role: input.role,
          work_place: input.work_place,
          work_place_revision: 1,
          continued_from: from,
        });
        tx.sql.run(
          `insert into sessions (id, assignment, role, work_place_kind,
             work_place_id, work_place_revision, state,
             continued_from_session, continued_from_through_seq,
             created_seq, state_seq)
           values (?, ?, ?, ?, ?, 1, 'open', ?, ?, ?, ?)`,
          [
            input.id,
            input.assignment,
            input.role,
            input.work_place.kind,
            input.work_place.id,
            from === null ? null : from.session,
            from === null ? null : BigInt(from.through_seq),
            Number(seq),
            Number(seq),
          ],
        );
        return ok({
          id: input.id,
          state: "open" as const,
          work_place: input.work_place,
          work_place_revision: 1 as const,
          state_seq: seq,
        });
      },
    },
    changeWorkPlace: {
      route: changeSessionWorkPlace,
      handle(tx, ctx, input: Input<typeof changeSessionWorkPlace>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        // App Engineer·Operator의 자리는 담당 범위로 고정이다(R16, R17).
        if (session.role !== "lophn" && session.role !== "context_engineer") {
          return reject(
            "forbidden",
            "the work place of this role is fixed to its scope",
          );
        }
        if (session.state !== "open") {
          return reject("conflict", "the session is closed");
        }
        if (
          session.state_seq !== compare.state_seq ||
          session.work_place_revision !== compare.work_place_revision ||
          session.role !== compare.role
        ) {
          return reject("conflict", "session changed");
        }
        const assignment = loadAssignmentRef(tx, session.assignment);
        if (assignment === undefined) {
          return reject("not_found", "assignment not found");
        }
        const place = checkPlace(tx, assignment, input.work_place);
        if (!place.ok) return place;
        if (
          session.work_place_kind === input.work_place.kind &&
          session.work_place_id === input.work_place.id
        ) {
          return reject("invalid_input", "the work place is already this one");
        }
        const revision = session.work_place_revision + 1;
        const seq = tx.emit(sessionWorkPlaceChanged, session.id, {
          before: {
            work_place: placeOf(session),
            work_place_revision: session.work_place_revision,
          },
          after: {
            work_place: input.work_place,
            work_place_revision: revision,
          },
        });
        tx.sql.run(
          `update sessions set work_place_kind = ?, work_place_id = ?,
             work_place_revision = ?, state_seq = ? where id = ?`,
          [
            input.work_place.kind,
            input.work_place.id,
            revision,
            Number(seq),
            session.id,
          ],
        );
        return ok({
          id: session.id,
          work_place: input.work_place,
          work_place_revision: revision,
          state_seq: seq,
        });
      },
    },
    close: {
      route: closeSession,
      handle(tx, ctx, input: Input<typeof closeSession>, compare) {
        const kind = parseActor(ctx.actor)?.kind;
        if (kind !== "user" && kind !== "machine") {
          return reject("forbidden", "closing needs a user or machine");
        }
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (kind === "user" && input.reason !== "user_closed") {
          return reject("forbidden", "a person closes with user_closed");
        }
        if (kind === "machine") {
          const assignment = loadAssignmentRef(tx, session.assignment);
          if (
            input.reason !== "assignment_withdrawn" ||
            assignment?.state !== "withdrawn"
          ) {
            return reject("forbidden", "the assignment is not withdrawn");
          }
        }
        if (session.state !== "open") {
          return reject("conflict", "the session is already closed");
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        // 미종료 run과 대기 요청을 먼저 정리해야 닫는다(R8).
        const live = tx.sql.get(
          "select 1 as found from runs where session = ? and state != 'finished' limit 1",
          [session.id],
        );
        if (live !== undefined) {
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
    receive: {
      route: receiveMessage,
      handle(tx, ctx, input: Input<typeof receiveMessage>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const body = bodyBlob(ctx, input.content);
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
        const registered = registerBody(tx, input.id, seq, body);
        if (!registered.ok) return registered;
        return stored(loadMessage(tx, input.id));
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
  };
}
