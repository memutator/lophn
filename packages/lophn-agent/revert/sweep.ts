import type { Sql } from "../../protocol/platform/mod.ts";
import type { RewindStore } from "./store.ts";

// session 저장소 쓸기(lophn-agent/revert "저장"). 저장물 설치와 ledger row 등록은 공동 원자 작업이 아니라
// 설치만 되고 row가 없는 고아와, 정리에 실패한 session 디렉터리가 남을 수 있다. 시작 때와 주기로 쓴다.

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// row가 가리키는 저장물의 key다: 쓰기 직전 pre-image(`before_blob`)와, 아직 redo할 수 있는 rewind가 복원
// 직전 내용을 둔 `redo_ref`. redo가 끝난(done·closed) 복원 직전 내용은 더 쓰지 않는다.
export function liveStoreKeys(lookup: Lookup, session: string): Set<string> {
  const keys = new Set<string>();
  for (
    const row of lookup.sql.all(
      `select distinct f.before_blob as key
         from rewind_files f join checkpoints c on c.message = f.checkpoint
        where c.session = ? and f.before_blob is not null
       union
       select distinct i.redo_ref as key
         from revert_items i join reverts r on r.id = i.revert
        where r.session = ? and r.redo = 'available' and i.redo_ref is not null`,
      [session, session],
    )
  ) keys.add(String(row["key"]));
  return keys;
}

export type RewindSweepDeps = {
  store: Pick<RewindStore, "sessions" | "sweep" | "removeSession">;
  // ledger를 짧게 읽는다. 읽지 못하면 아무것도 지우지 않는다(throw).
  snapshot<T>(read: (lookup: Lookup) => T): T;
  // 이 시각(epoch ms) 뒤에 만든 저장물은 row 등록 전일 수 있어 건너뛴다.
  skipNewerThan: number;
};

export type RewindSweepResult = {
  // 닫히거나 지워져 디렉터리를 통째로 지운 session.
  sessions: string[];
  // 열린 session에서 지운 고아 저장물 수.
  orphans: number;
};

// 열린 session은 row가 가리키지 않는 저장물만, 닫히거나 없어진 session은 디렉터리 전체를 지운다. 한 session의
// 실패가 다른 session의 정리를 막지 않는다.
export async function sweepRewindStore(
  deps: RewindSweepDeps,
): Promise<RewindSweepResult> {
  const result: RewindSweepResult = { sessions: [], orphans: 0 };
  for (const session of await deps.store.sessions()) {
    try {
      const seen = deps.snapshot((lookup) => {
        const row = lookup.sql.get("select state from sessions where id = ?", [
          session,
        ]);
        return row?.["state"] === "open"
          ? { open: true as const, live: liveStoreKeys(lookup, session) }
          : { open: false as const };
      });
      if (!seen.open) {
        await deps.store.removeSession(session);
        result.sessions.push(session);
        continue;
      }
      const removed = await deps.store.sweep(session, seen.live, {
        skipNewerThan: deps.skipNewerThan,
      });
      result.orphans += removed.length;
    } catch {
      // 다음 쓸기가 다시 본다.
    }
  }
  return result;
}
