import type { Sql } from "../../../../protocol/server/mod.ts";
import type { FileStat } from "./judge.ts";
import { observeFilesAsync } from "./restore.ts";

// 시작 때 맞추기(lophn-agent/revert "복원 쓰기"). command가 확정되고 설치되기 전에 process가 죽으면 ledger는
// restored인데 파일은 agent가 마지막으로 쓴 그대로다. 파일이 아직 복원되지 않았음을 hash로 확인한 경로만
// AmendRevertInstall이 skipped(edited_outside)로 고치게 모은다.
//
// 설치를 이어서 하지 않는 까닭: 사람이 시작한 복원 쓰기는 그 순간 사람이 본 hash 위에서만 성립한다. 시간이
// 지난 뒤 이어 쓰면 사람이 고친 내용을 덮을 수 있다. 복원했다고 거짓으로 남기지 않는 것까지만 한다.

type Lookup = { sql: Pick<Sql, "get" | "all"> };

export type UninstalledCandidate = {
  revert: string;
  session: string;
  // 허용 폴더(절대 경로)와 그 안의 상대 경로.
  root: string;
  path: string;
  // agent가 그 경로에 마지막으로 쓴 상태(복원 전). 파일이 아직 이 상태면 설치되지 않은 것이다.
  after: { exists: boolean; sha256: string | null };
  // 복원이 만들었어야 할 상태. null이면 파일이 없어야 한다.
  restored_sha256: string | null;
};

// 열린 session의 가장 나중 revert 하나만 본다. 그보다 앞선 revert의 복원은 그 뒤의 사람·agent의 일이 파일을
// 바꿨을 수 있어 hash만으로 설치 여부를 가를 수 없다. 이름 변경이 낀 단위는 건드리지 않는다.
export function uninstalledCandidates(lookup: Lookup): UninstalledCandidate[] {
  const found: UninstalledCandidate[] = [];
  const latest = lookup.sql.all(
    `select r.id as id, r.session as session
       from reverts r join sessions s on s.id = r.session
      where s.lifecycle = 'open' and r.outcome = 'applied'
        and r.rowid = (
          select max(rowid) from reverts
           where session = r.session and outcome != 'blocked'
        )`,
    [],
  );
  for (const revert of latest) {
    const id = String(revert["id"]);
    for (const item of lookup.sql.all(
      `select target, restored_sha256 from revert_items
          where revert = ? and class = 'file' and plan = 'restore' and result = 'restored'`,
      [id],
    )) {
      const path = String(item["target"]);
      const records = lookup.sql.all(
        `select root, after_exists, after_sha256, moved_from from rewind_files
          where reverted_by = ? and (path = ? or moved_from = ?) order by seq desc`,
        [id, path, path],
      );
      const last = records[0];
      if (last === undefined || records.some((r) => r["moved_from"] !== null)) {
        continue;
      }
      // 복원 뒤에 agent가 그 경로를 다시 썼으면(되돌려짐 표시가 없는 기록) 파일의 지금 상태는 설치 여부와
      // 상관이 없다.
      const rewritten = lookup.sql.get(
        `select 1 as found from rewind_files f
           join checkpoints c on c.message = f.checkpoint
          where c.session = ? and f.path = ? and f.reverted_by is null limit 1`,
        [String(revert["session"]), path],
      );
      if (rewritten !== undefined) continue;
      found.push({
        revert: id,
        session: String(revert["session"]),
        root: String(last["root"]),
        path,
        after: {
          exists: Number(last["after_exists"]) === 1,
          sha256:
            last["after_sha256"] === null ? null : String(last["after_sha256"]),
        },
        restored_sha256:
          item["restored_sha256"] === null
            ? null
            : String(item["restored_sha256"]),
      });
    }
  }
  return found;
}

function sameState(
  stat: FileStat,
  state: { exists: boolean; sha256: string | null },
): boolean {
  return (
    !stat.link &&
    stat.exists === state.exists &&
    (!state.exists || stat.sha256 === state.sha256)
  );
}

// 파일이 아직 agent가 마지막으로 쓴 상태이고 복원이 만들 상태와 다른 경로, 곧 설치되지 않은 경로다.
export async function findUninstalled(
  candidates: readonly UninstalledCandidate[],
): Promise<UninstalledCandidate[]> {
  if (candidates.length === 0) return [];
  const seen = new Map<string, FileStat>();
  for (const root of new Set(candidates.map((c) => c.root))) {
    const paths = candidates.filter((c) => c.root === root).map((c) => c.path);
    for (const [path, stat] of await observeFilesAsync(root, paths)) {
      seen.set(`${root}\n${path}`, stat);
    }
  }
  return candidates.filter((candidate) => {
    const stat = seen.get(`${candidate.root}\n${candidate.path}`);
    if (stat === undefined) return false;
    const restored = {
      exists: candidate.restored_sha256 !== null,
      sha256: candidate.restored_sha256,
    };
    return sameState(stat, candidate.after) && !sameState(stat, restored);
  });
}
