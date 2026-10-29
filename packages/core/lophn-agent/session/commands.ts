import { canonicalize, ok, type Result } from "../../../base/mod.ts";
import type { CatalogEntry } from "../../../protocol/lophn-agent/mod.ts";
import {
  archiveSession,
  changeSessionModel,
  changeSessionSkip,
  type compactSession,
  deleteSession,
  type failSessionCompact,
  type forkSession,
  MESSAGE_BODY_OWNER_KIND,
  placeSessionOpen,
  type recordMessage,
  renameSession,
  type requestSessionCompact,
  type sendMessage,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { endSession, startSession } from "../places/lifecycle.ts";
import type { EndDeps, OpenDeps } from "../places/ports.ts";
import { createCompactCommands } from "./compact.ts";
import { createForkCommand } from "./fork.ts";
import { deleteSessionReverts } from "./rewind/mod.ts";
import { reject, requireUser, sessionNotFound } from "./guards.ts";
import {
  createMessageCommands,
  type SendMessageDeps,
} from "./message-commands.ts";
import {
  loadSession,
  modelSelectionOf,
  nextSessionSeq,
  placeOf,
  type SessionRow,
} from "./model.ts";
import { defaultIfUnset, showChosen } from "../models/store.ts";
import { checkSessionModel } from "./session-model.ts";
import { renameSessionTitle } from "./session-title.ts";

// 세션 command. 등록 순서와 transaction 규칙은 message-commands.ts와 같다.

type ConversationDeps = {
  // 사람 메시지를 같은 Tx에서 Router로 입력함에 넣는다. 조립이 Router와 session 목록을 건다.
  send: SendMessageDeps;
  // 세션을 지울 때 같은 Tx에서 그 세션의 turn 기록을 지운다. 기록을 가진 concern마다
  // 자기 몫을 지우고 조립이 그것들을 잇는다. 메시지는 이 함수를 부르기 전에 지워져 있다.
  deleteSessionRecords: (tx: Tx, session: string) => Result<void>;
  // model 선택 저장 검사가 보는 catalog. 화면이 읽는 catalog와 같은 바탕이다.
  catalog: (tx: Tx) => readonly CatalogEntry[];
  // 메시지 본문의 blob 영구 참조를 지운다(platform/blob-store). 소유 행인 메시지보다 먼저 부른다.
  eraseBlobRefs: (
    tx: Tx,
    ownerKind: string,
    ownerKeys: readonly string[],
  ) => Result<void>;
  // session을 열 때 agent 정의와 place를 확인하고 SessionStarted를 낸다. 그 tx의 sql로 읽는다.
  open: (tx: Tx) => OpenDeps;
  // archive와 지움이 묶는 영향.
  end: EndDeps;
};

function openedOf(row: SessionRow) {
  return {
    id: row.id,
    lifecycle: "open" as const,
    place: placeOf(row),
    state_seq: row.state_seq,
  };
}

export function createConversationCommands(deps: ConversationDeps): {
  open: CommandDefinition<typeof placeSessionOpen>;
  rename: CommandDefinition<typeof renameSession>;
  archive: CommandDefinition<typeof archiveSession>;
  delete: CommandDefinition<typeof deleteSession>;
  changeModel: CommandDefinition<typeof changeSessionModel>;
  changeSkip: CommandDefinition<typeof changeSessionSkip>;
  fork: CommandDefinition<typeof forkSession>;
  requestCompact: CommandDefinition<typeof requestSessionCompact>;
  compact: CommandDefinition<typeof compactSession>;
  failCompact: CommandDefinition<typeof failSessionCompact>;
  send: CommandDefinition<typeof sendMessage>;
  record: CommandDefinition<typeof recordMessage>;
} {
  return {
    ...createMessageCommands(deps.send),
    fork: createForkCommand(deps.open),
    ...createCompactCommands(),
    open: {
      route: placeSessionOpen,
      handle(tx, ctx: RequestContext, input: Input<typeof placeSessionOpen>) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const existing = loadSession(tx, input.id);
        if (existing !== undefined) {
          const same =
            existing.agent === input.agent &&
            canonicalize(placeOf(existing)) === canonicalize(input.place);
          if (!same) return reject("conflict", "session id already used");
          if (existing.lifecycle !== "open") {
            return reject("conflict", "session changed since it was opened");
          }
          return ok(openedOf(existing));
        }
        const started = startSession(tx, deps.open(tx), {
          id: input.id,
          agent: input.agent,
          place: input.place,
        });
        return started.ok ? ok(openedOf(started.value)) : started;
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
        // 같은 제목이면 이전 결과다. archive한 session도 이름을 바꾼다.
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
        const seq = nextSessionSeq(tx);
        tx.sql.run(
          "update sessions set title = ?, state_seq = ? where id = ?",
          [title.value, seq, session.id],
        );
        return ok({
          id: session.id,
          title: title.value,
          state_seq: String(seq),
        });
      },
    },
    archive: {
      route: archiveSession,
      handle(tx, ctx, input: Input<typeof archiveSession>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const row = loadSession(tx, input.session);
        if (row === undefined) return sessionNotFound();
        // 이미 archive했으면 이전 결과다. 낡은 seq의 재전송도 같은 결과를 받는다.
        if (row.lifecycle === "archived") {
          return ok({
            id: row.id,
            archived: true as const,
            state_seq: row.state_seq,
          });
        }
        if (row.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        const seq = nextSessionSeq(tx);
        tx.sql.run(
          "update sessions set lifecycle = 'archived', state_seq = ? where id = ?",
          [seq, row.id],
        );
        const ended = endSession(tx, deps.end, row, "archived");
        if (!ended.ok) return ended;
        return ok({
          id: row.id,
          archived: true as const,
          state_seq: String(seq),
        });
      },
    },
    delete: {
      route: deleteSession,
      handle(tx, ctx, input: Input<typeof deleteSession>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        // 도는 turn은 interrupted로 닫고 진행한다. 닫은 뒤에야 기록을 지운다.
        const ended = endSession(tx, deps.end, session, "deleted");
        if (!ended.ok) return ended;
        const bodies = deps.eraseBlobRefs(
          tx,
          MESSAGE_BODY_OWNER_KIND,
          tx.sql
            .all("select id from messages where session = ?", [session.id])
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
        return ok({ id: session.id, deleted_at: tx.now() });
      },
    },
    changeModel: {
      route: changeSessionModel,
      handle(tx, ctx, input: Input<typeof changeSessionModel>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (session.lifecycle !== "open") {
          return reject("conflict", "the session is archived");
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
          const checked = checkSessionModel(tx, deps.catalog(tx), input.model);
          if (!checked.ok) return checked;
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        const seq = nextSessionSeq(tx);
        tx.sql.run(
          "update sessions set model_selection = ?, state_seq = ? where id = ?",
          [
            input.model === null ? null : canonicalize(input.model),
            seq,
            session.id,
          ],
        );
        // 사람이 고른 model은 picker에 보이고, 전역 기본이 비어 있으면 첫 선택이 기본이 된다.
        if (input.model !== null) {
          showChosen(tx.sql, input.model);
          defaultIfUnset(tx.sql, input.model);
        }
        return ok({
          id: session.id,
          model_selection: input.model,
          state_seq: String(seq),
        });
      },
    },
    // 도는 turn은 시작 때 정한 mode를 쓰므로 바꾼 값은 다음 turn부터 닿는다.
    changeSkip: {
      route: changeSessionSkip,
      handle(tx, ctx, input: Input<typeof changeSessionSkip>, compare) {
        const user = requireUser(ctx);
        if (!user.ok) return user;
        const session = loadSession(tx, input.session);
        if (session === undefined) return sessionNotFound();
        if (session.lifecycle !== "open") {
          return reject("conflict", "the session is archived");
        }
        if (session.skip === input.skip) {
          return ok({
            id: session.id,
            skip: session.skip,
            state_seq: session.state_seq,
          });
        }
        if (session.state_seq !== compare.state_seq) {
          return reject("conflict", "session changed");
        }
        const seq = nextSessionSeq(tx);
        tx.sql.run("update sessions set skip = ?, state_seq = ? where id = ?", [
          input.skip ? 1 : 0,
          seq,
          session.id,
        ]);
        return ok({
          id: session.id,
          skip: input.skip,
          state_seq: String(seq),
        });
      },
    },
  };
}
