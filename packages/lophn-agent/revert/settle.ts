import type {
  PreparedFile,
  PreviewItem,
  RevertItem,
  RevertResultCounts,
} from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/platform/mod.ts";
import type { FileStat, JudgedFile } from "./judge.ts";
import type { RewindPlan } from "./preview.ts";
import { restorable } from "./restore.ts";

// 판정(preview)을 revert 결과 항목으로 굳히고 ledger에 쓰는 일이다. Rewind·UndoEdit·AmendRevertInstall이
// 같이 쓴다.

// 항목 하나와 그 결과, redo 근거다. 문서 파일 항목이 복원됐을 때만 restored_sha256·redo_ref가 있다.
export type SettledItem = {
  item: PreviewItem;
  result: RevertItem["result"];
  restored_sha256: string | null;
  redo_ref: string | null;
  // 복원한 문서 파일의 판정 단위.
  restored: JudgedFile | null;
};

// command가 받은 준비(files)를 판정에 쓰는 관측으로 바꾼다. 준비가 없는 경로는 관측에 없다.
export function observedOf(
  files: readonly PreparedFile[],
): Map<string, FileStat> {
  return new Map(files.map((file) => [file.path, {
    exists: file.observed_sha256 !== null || file.link,
    sha256: file.observed_sha256,
    link: file.link,
  }]));
}

// 복원할 문서 파일이 준비를 받쳐 주면 restored다. 받쳐 주지 않으면 복원했다고 쓰지 않고 설치가 건너뛴
// 것과 같은 모양(skipped, edited_outside)으로 남긴다. 건너뛰는 항목은 skipped이고, 이미 Undo한 기록만
// 바뀐 것이 없어 unchanged다.
export function settleItems(
  plan: RewindPlan,
  files: readonly PreparedFile[],
  keepRedo: boolean,
): SettledItem[] {
  const prepared = new Map(files.map((file) => [file.path, file]));
  const units = new Map(plan.judged.map((file) => [file.path, file]));
  const items = [
    ...plan.preview.restore,
    ...plan.preview.skip,
    ...plan.preview.remain,
  ].sort((left, right) => left.ordinal - right.ordinal);
  return items.map((item): SettledItem => {
    const none = { restored_sha256: null, redo_ref: null, restored: null };
    if (item.plan === "remain") return { item, result: "remained", ...none };
    if (item.plan === "skip") {
      const result = item.reason === "already_reverted"
        ? "unchanged"
        : "skipped";
      return { item, result, ...none };
    }
    const unit = units.get(item.target);
    if (unit === undefined || !restorable(unit, prepared)) {
      return {
        item: { ...item, reason: "edited_outside" },
        result: "skipped",
        ...none,
      };
    }
    return {
      item,
      result: "restored",
      restored_sha256: unit.restored_sha256,
      redo_ref: keepRedo ? prepared.get(unit.path)?.redo_ref ?? null : null,
      restored: unit,
    };
  });
}

export function countsOf(
  results: readonly RevertItem["result"][],
): RevertResultCounts {
  const counts: RevertResultCounts = {
    restored: 0,
    skipped: 0,
    remained: 0,
    failure: 0,
    uncertain: 0,
    unchanged: 0,
  };
  for (const result of results) counts[result] += 1;
  return counts;
}

// 건너뜀이나 남는 영향이 하나라도 있었나.
export function leftSomething(counts: RevertResultCounts): boolean {
  return counts.skipped > 0 || counts.remained > 0 || counts.failure > 0 ||
    counts.uncertain > 0;
}

export function insertItems(
  tx: Tx,
  revert: string,
  settled: readonly SettledItem[],
): void {
  for (const entry of settled) {
    tx.sql.run(
      `insert into revert_items
         (revert, ordinal, class, target, source, plan, result, reason, app_revert,
          restored_sha256, redo_ref)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        revert,
        entry.item.ordinal,
        entry.item.class,
        entry.item.target,
        JSON.stringify(entry.item.source),
        entry.item.plan,
        entry.result,
        entry.item.reason,
        entry.item.app_revert === null
          ? null
          : JSON.stringify(entry.item.app_revert),
        entry.restored_sha256,
        entry.redo_ref,
      ],
    );
  }
}

// 한 판정 단위가 쓴 기록 행이다. 이름 변경은 옛 경로의 기록까지 이어 따라간다.
function unitRows(
  tx: Tx,
  source: readonly string[],
  paths: readonly string[],
): { tool_call: string; path: string }[] {
  const reach = new Set(paths);
  const rows = new Map<string, { tool_call: string; path: string }>();
  for (let grew = true; grew;) {
    grew = false;
    for (const tool_call of source) {
      for (
        const row of tx.sql.all(
          "select path, moved_from from rewind_files where tool_call = ?",
          [tool_call],
        )
      ) {
        const path = String(row["path"]);
        if (!reach.has(path) || rows.has(`${tool_call}\n${path}`)) continue;
        rows.set(`${tool_call}\n${path}`, { tool_call, path });
        grew = true;
        if (row["moved_from"] !== null) reach.add(String(row["moved_from"]));
      }
    }
  }
  return [...rows.values()];
}

// 복원한 단위의 기록에 되돌려짐을 표시한다. 이미 표시된 기록(앞선 Undo)은 건드리지 않는다.
export function markReverted(
  tx: Tx,
  revert: string,
  unit: JudgedFile,
): void {
  for (const row of unitRows(tx, unit.source, [unit.path])) {
    tx.sql.run(
      `update rewind_files set reverted_by = ?
        where tool_call = ? and path = ? and reverted_by is null`,
      [revert, row.tool_call, row.path],
    );
  }
}

// 이 revert가 표시한 기록의 표시를 푼다(Redo, 설치 정정).
export function releaseReverted(
  tx: Tx,
  revert: string,
  source: readonly string[],
  path: string,
): void {
  for (const row of unitRows(tx, source, [path])) {
    tx.sql.run(
      `update rewind_files set reverted_by = null
        where tool_call = ? and path = ? and reverted_by = ?`,
      [row.tool_call, row.path, revert],
    );
  }
}
