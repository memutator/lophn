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
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { createCompactCommands } from "./compact.ts";
import { createForkCommand } from "./fork.ts";
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
  };
}
