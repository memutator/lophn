// 다른 기계들의 활성 release 가운데 이 기계가 따라갈 하나를 고른다. 순서는 번호나 시각이 아니라 git 조상이다:
// 시각으로 고르면 갈라진 code를 오간다. git은 함수로 받는다.
import type { Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";

export type FollowRelease = {
  code_commit: string;
  data_schema: number;
};

/** 다른 기계의 앱 기록이 말하는 그 기계의 활성 release. */
export type OfferedRelease = FollowRelease & {
  machine: Id<"mch">;
  created_at: string;
};

/** `"missing"`: commit이 이 저장소에 아직 없다(source bundle이 아직 안 왔다). */
export type IsAncestor = (
  ancestor: string,
  descendant: string,
) => Promise<Result<boolean | "missing">>;

export type FollowChoice =
  | { kind: "current" }
  | { kind: "target"; release: OfferedRelease }
  | { kind: "diverged"; release: OfferedRelease };

export async function chooseRelease(input: {
  current: FollowRelease;
  offered: readonly OfferedRelease[];
  // 이 기계에서 superseded나 failed인 code_commit. 내려놓았거나 실패한 release는 다시 하지 않는다.
  dropped: ReadonlySet<string>;
  isAncestor: IsAncestor;
}): Promise<FollowChoice> {
  const { current } = input;
  // 같은 commit을 여러 기계가 돌리면 먼저 활성한 기계의 것 하나.
  const byCommit = new Map<string, OfferedRelease>();
  for (const offered of input.offered) {
    const seen = byCommit.get(offered.code_commit);
    if (seen === undefined || offered.created_at < seen.created_at) {
      byCommit.set(offered.code_commit, offered);
    }
  }
  const candidates: OfferedRelease[] = [];
  // 지금 commit의 자손도 조상도 아닌 release: 그 기계와 이 기계가 따로 release를 냈다.
  const apart: OfferedRelease[] = [];
  for (const offered of byCommit.values()) {
    if (offered.code_commit === current.code_commit) continue;
    if (input.dropped.has(offered.code_commit)) continue;
    // 자손인지 모르면(commit이 아직 없거나 git이 실패) 이번에는 빼고 다음 계기에 다시 본다.
    const after = await input.isAncestor(
      current.code_commit,
      offered.code_commit,
    );
    if (!after.ok || after.value === "missing") continue;
    if (after.value) {
      if (offered.data_schema >= current.data_schema) candidates.push(offered);
      continue;
    }
    const before = await input.isAncestor(
      offered.code_commit,
      current.code_commit,
    );
    if (before.ok && before.value === false) apart.push(offered);
  }
  const byCreated = (a: OfferedRelease, b: OfferedRelease) =>
    a.created_at < b.created_at
      ? -1
      : a.created_at > b.created_at
        ? 1
        : a.code_commit < b.code_commit
          ? -1
          : 1;
  if (candidates.length === 0) {
    return apart.length === 0
      ? { kind: "current" }
      : { kind: "diverged", release: apart.sort(byCreated).at(-1)! };
  }

  const known = new Map<string, boolean>();
  async function below(ancestor: string, descendant: string) {
    if (ancestor === descendant) return true;
    const pair = `${ancestor}:${descendant}`;
    let value = known.get(pair);
    if (value === undefined) {
      const read = await input.isAncestor(ancestor, descendant);
      value = read.ok && read.value === true;
      known.set(pair, value);
    }
    return value;
  }
  // 나머지 모두가 조상인 후보로 바로 간다(migration은 누적이라 중간 release를 건너뛴다).
  const tops: OfferedRelease[] = [];
  for (const top of candidates) {
    let all = true;
    for (const other of candidates) {
      if (!(await below(other.code_commit, top.code_commit))) {
        all = false;
        break;
      }
    }
    if (all) tops.push(top);
  }
  if (tops.length > 0) {
    return { kind: "target", release: tops.sort(byCreated)[0]! };
  }
  return { kind: "diverged", release: candidates.sort(byCreated).at(-1)! };
}
