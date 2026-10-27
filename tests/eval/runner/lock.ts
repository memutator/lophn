import { EXPERIMENTS_DIR, type LockFacts } from "../experiment/spec/mod.ts";
import { denoGit, type Git } from "../versions/mod.ts";

const ok = (run: () => Promise<unknown>) =>
  run().then(
    () => true,
    () => false,
  );

// spec이 고침보다 먼저 commit됐는지 판정할 사실을 git으로 모은다. 판정은 checkSpecLocked가 한다.
// spec_dirty는 spec.json만 본다: 돌린 뒤 생기는 result.json이 이어 돌리기를 막으면 안 된다.
export async function collectLockFacts(args: {
  id: string;
  current: string;
  variant: string; // 지금 checkout이면 같은 값
  cases: { id: string; path: string }[]; // 시나리오 file의 절대 경로
}): Promise<LockFacts> {
  const specPath = `${EXPERIMENTS_DIR}/${args.id}/spec.json`;
  const base = denoGit(args.current);
  const variant: Git =
    args.variant === args.current ? base : denoGit(args.variant);

  const commit = (
    await base(["log", "-1", "--format=%H", "--", specPath])
  ).trim();
  if (commit === "") {
    return {
      spec_commit: null,
      spec_dirty: false,
      spec_commit_on_current: false,
      variant_has_spec_commit: false,
      variant_spec_same: false,
      cases_missing_at_spec_commit: [],
    };
  }
  const atCommit = `${commit}:${specPath}`;
  const specAtCommit = await base(["show", atCommit]);
  const missing: string[] = [];
  for (const c of args.cases) {
    const rel = c.path.slice(args.current.length + 1);
    if (!(await ok(() => base(["cat-file", "-e", `${commit}:${rel}`])))) {
      missing.push(c.id);
    }
  }
  return {
    spec_commit: commit,
    spec_dirty:
      (await base(["status", "--porcelain", "--", specPath])).trim() !== "",
    spec_commit_on_current: await ok(() =>
      base(["merge-base", "--is-ancestor", commit, "HEAD"]),
    ),
    variant_has_spec_commit: await ok(() =>
      variant(["merge-base", "--is-ancestor", commit, "HEAD"]),
    ),
    variant_spec_same:
      (await variant(["show", `HEAD:${specPath}`]).catch(() => null)) ===
      specAtCommit,
    cases_missing_at_spec_commit: missing,
  };
}
