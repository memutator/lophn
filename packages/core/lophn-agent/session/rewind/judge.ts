import type {
  FileState,
  RewindReason,
} from "../../../../protocol/lophn-agent/mod.ts";

// 파일 복원 판정(lophn-agent/revert "판정 규칙"). 기록(RewindFile)과 파일의 지금 상태만 받는 순수
// 함수다. 파일은 허용 폴더(root)와 그 안의 상대 경로(path)로 가리킨다. 한 session에서 같은 상대 경로가
// 두 root에 있으면 어느 쪽인지 가를 수 없어 복원하지 않는다(chain_broken).

export type JudgeRecord = {
  tool_call: string;
  root: string;
  path: string;
  seq: string;
  before: FileState;
  after: { exists: boolean; sha256: string | null };
  moved_from: string | null;
  reverted_by: string | null;
};

// 파일의 지금 상태. link는 symlink이거나 hard link인 경로다.
export type FileStat = {
  exists: boolean;
  sha256: string | null;
  link: boolean;
};

type FileAction =
  | { kind: "write"; path: string; sha256: string; blob: string }
  | { kind: "delete"; path: string };

export type JudgedFile = {
  // 판정 단위의 허용 폴더(절대 경로)다. 아래 path와 actions의 path는 이 폴더 안의 상대 경로다.
  root: string;
  // 판정 단위의 경로(마지막 기록의 path)다. 이름 변경이면 새 경로다.
  path: string;
  // 이 경로를 쓴 tool call. 되돌림에서 빠진(reverted_by) 기록은 들지 않고 seq 순서다.
  source: string[];
  plan: "restore" | "skip";
  reason: RewindReason | null;
  // plan=restore일 때만 있다. 첫 기록의 before로 교체하거나(write) 지운다(delete).
  actions: FileAction[];
  // 복원한 뒤 이 경로의 내용 hash. 사라지면 null. 시작 때 맞추기가 설치 여부를 가린다.
  restored_sha256: string | null;
};

// 경로마다 `reverted_by`가 없는 기록을 seq 순서로 모아 사슬을 확인한다. 이유 코드는 이 순서로 정한다.
//   0. 한 단위에 허용 폴더가 둘 이상이면 skip `chain_broken`.
//   1. 기록이 모두 되돌려졌으면 skip `already_reverted`.
//   2. 지금 경로가 symlink·hard link면 skip `link_path`.
//   3. 사슬의 어느 기록이든 before가 있었는데 pre-image(blob)가 없으면 skip `no_pre_image`.
//   4. 앞 기록의 after와 뒤 기록의 before가 다르면 skip `chain_broken`.
//   5. 지금 hash가 마지막 after와 다르면: 첫 before가 없었던 파일(agent가 만든 파일)이고 지금
//      파일이 있으면 skip `created_edited`, 아니면 skip `edited_outside`. 지금 파일이 없고 마지막
//      after.exists면 복원한다(되살림).
//   6. 이름 변경이면 옛 경로(moved_from)에 이미 파일이 있을 때 skip `rename_blocked`.
//   7. 아니면 restore: 첫 before가 있었으면 write, 없었으면 delete. 이름 변경은 옛 경로에 write하고
//      새 경로를 delete한다.
// 결과는 첫 기록의 seq 오름차순이다. current에 없는 경로는 파일이 없는 것으로 본다.
export function judgeFiles(input: {
  records: readonly JudgeRecord[];
  current: ReadonlyMap<string, FileStat>;
}): JudgedFile[] {
  return groupByUnit(input.records)
    .map((group) => judgeUnit(group, input.current))
    .sort((left, right) => compareSeq(left.firstSeq, right.firstSeq))
    .map((entry) => entry.judged);
}

const GONE: FileStat = { exists: false, sha256: null, link: false };

function compareSeq(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

// 이름 변경은 옛 경로와 새 경로의 기록을 한 사슬로 잇는다. 같은 경로이거나 이름 변경으로 이어진
// 경로의 기록이 한 단위다.
function groupByUnit(records: readonly JudgeRecord[]): JudgeRecord[][] {
  const parent = new Map<string, string>();
  const find = (path: string): string => {
    let root = parent.get(path) ?? path;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root)!;
    parent.set(path, root);
    return root;
  };
  for (const record of records) {
    const root = find(record.path);
    if (record.moved_from !== null) parent.set(find(record.moved_from), root);
  }
  const groups = new Map<string, JudgeRecord[]>();
  for (const record of records) {
    const key = find(record.path);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].map((group) =>
    group.sort((left, right) => compareSeq(left.seq, right.seq)),
  );
}

const hashOf = (state: { exists: boolean; sha256: string | null }) =>
  state.exists ? state.sha256 : null;

function judgeUnit(
  group: readonly JudgeRecord[],
  current: ReadonlyMap<string, FileStat>,
): { firstSeq: string; judged: JudgedFile } {
  const active = group.filter((record) => record.reverted_by === null);
  const shown = active.length === 0 ? group : active;
  const first = shown[0]!;
  const last = shown[shown.length - 1]!;
  const make = (
    plan: "restore" | "skip",
    reason: RewindReason | null,
    actions: FileAction[] = [],
    restored: string | null = null,
  ): { firstSeq: string; judged: JudgedFile } => ({
    firstSeq: group[0]!.seq,
    judged: {
      root: last.root,
      path: last.path,
      source: shown.map((record) => record.tool_call),
      plan,
      reason,
      actions,
      restored_sha256: restored,
    },
  });
  const skip = (reason: RewindReason) => make("skip", reason);

  if (new Set(group.map((record) => record.root)).size > 1) {
    return skip("chain_broken");
  }
  if (active.length === 0) return skip("already_reverted");
  const now = current.get(last.path) ?? GONE;
  if (now.link) return skip("link_path");
  if (
    active.some((record) => record.before.exists && record.before.blob === null)
  ) {
    return skip("no_pre_image");
  }
  for (let index = 1; index < active.length; index++) {
    if (hashOf(active[index - 1]!.after) !== hashOf(active[index]!.before)) {
      return skip("chain_broken");
    }
  }
  if (hashOf(now) !== hashOf(last.after) && now.exists) {
    return skip(first.before.exists ? "edited_outside" : "created_edited");
  }
  const origin = first.moved_from ?? first.path;
  const moved = origin !== last.path;
  if (moved && (current.get(origin) ?? GONE).exists) {
    return skip("rename_blocked");
  }
  const write = first.before.exists
    ? [
        {
          kind: "write" as const,
          path: origin,
          sha256: first.before.sha256!,
          blob: first.before.blob!,
        },
      ]
    : [];
  if (moved) {
    return make("restore", null, [
      ...write,
      {
        kind: "delete",
        path: last.path,
      },
    ]);
  }
  return write.length > 0
    ? make("restore", null, write, first.before.sha256)
    : make("restore", null, [{ kind: "delete", path: last.path }]);
}
