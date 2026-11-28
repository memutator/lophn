import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createIdSource, ok, seededRandom } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { DEFAULT_WORKTREE_SETTINGS } from "../../../protocol/projects/worktrees.ts";
import {
  assertSafeRefName,
  computeWorktreePath,
  copyGitignoredFiles,
  createWorktreeService,
  type GitRunner,
  type GitRunResult,
  isGitAuthError,
  parsePorcelainV2Z,
  redactGitUrlCredentials,
  type StoredWorktreeRow,
  validateWorktreesRoot,
} from "./mod.ts";

const PRJ = "prj_00000000000000000000000001" as Id<"prj">;
const NOW = "2026-11-28T00:00:00.000Z";
const FIXED_CLOCK = { now: () => NOW, nowMs: () => Date.parse(NOW) };

function gitOk(stdout = "", stderr = ""): GitRunResult {
  return { code: 0, stdout, stderr, timedOut: false, notFound: false };
}

function gitFail(stderr: string, code = 1): GitRunResult {
  return { code, stdout: "", stderr, timedOut: false, notFound: false };
}

// 이 규칙이 깨지면 홈·루트·repo 안 경로를 관리 루트로 허용해 remove 시 사용자 데이터를 지운다.
test("validateWorktreesRoot rejects unsafe roots and computeWorktreePath enforces Windows budget & ref safety", () => {
  assert.equal(validateWorktreesRoot("relative/path").ok, false);
  assert.equal(validateWorktreesRoot("/").ok, false);
  assert.equal(
    validateWorktreesRoot("/home/user", { homeDir: "/home/user" }).ok,
    false,
  );
  assert.equal(
    validateWorktreesRoot("/home", { homeDir: "/home/user" }).ok,
    false,
  );
  assert.equal(
    validateWorktreesRoot("/repo/sub", { repoRoots: ["/repo"] }).ok,
    false,
  );
  assert.equal(
    validateWorktreesRoot("/repo", { repoRoots: ["/repo/sub"] }).ok,
    false,
  );
  assert.equal(
    validateWorktreesRoot("/data/worktrees", {
      homeDir: "/home/user",
      repoRoots: ["/home/user/repo"],
    }).ok,
    true,
  );

  // Windows reserved names & 220-char budget
  const p = computeWorktreePath({
    worktreesRoot: "/data/wt",
    repoRoot: "/repos/CON",
    gitCommonDir: "/repos/CON/.git",
    branch: "NUL",
    id: "wkt_0123456789abcdef0123456789",
    platform: "win32",
  });
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.ok(!/[/\\](CON|NUL)[/\\]/i.test(p.value));
    assert.ok(p.value.length <= 220);
  }
  const tooLong = computeWorktreePath({
    worktreesRoot: `/${"a".repeat(210)}`,
    repoRoot: "/repos/demo",
    gitCommonDir: "/repos/demo/.git",
    branch: "feat/test",
    id: "wkt_0123456789abcdef0123456789",
    platform: "win32",
  });
  assert.equal(tooLong.ok, false);

  // ref name injection guards
  assert.equal(assertSafeRefName("-b").ok, false);
  assert.equal(assertSafeRefName("feat..bad").ok, false);
  assert.equal(assertSafeRefName("feat@{1}").ok, false);
  assert.equal(assertSafeRefName("feat.lock").ok, false);
  assert.equal(assertSafeRefName("feat/worktree-1").ok, true);

  // secret boundary: HTTP(S) URL credentials redacted, SSH user@host preserved
  assert.equal(
    redactGitUrlCredentials(
      "fatal: unable to access 'https://alice:ghp_secret123@github.com/org/repo.git/': The requested URL returned error: 403",
    ),
    "fatal: unable to access 'https://[REDACTED]@github.com/org/repo.git/': The requested URL returned error: 403",
  );
  assert.equal(
    redactGitUrlCredentials("git@github.com:org/repo.git Permission denied"),
    "git@github.com:org/repo.git Permission denied",
  );
  assert.equal(isGitAuthError("The requested URL returned error: 403"), true);
  assert.equal(isGitAuthError("remote: HTTP/1.1 401 Unauthorized"), true);
  assert.equal(
    isGitAuthError("error: failed to push to http://127.0.0.1:4010/repo.git"),
    false,
  );
  assert.equal(isGitAuthError("fatal: bad object abc403def"), false);
});

test("parsePorcelainV2Z counts staged, unstaged, untracked, conflicted, ahead/behind", () => {
  const sample = [
    "# branch.oid 0123456789abcdef",
    "# branch.head feat/wt",
    "# branch.upstream origin/feat/wt",
    "# branch.ab +3 -1",
    "1 M. N... 100644 100644 100644 aaa bbb staged.ts",
    "1 .M N... 100644 100644 100644 aaa bbb unstaged.ts",
    "1 MM N... 100644 100644 100644 aaa bbb both.ts",
    "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
    "? untracked.env",
  ].join("\0");
  const parsed = parsePorcelainV2Z(sample);
  assert.equal(parsed.branch, "feat/wt");
  assert.equal(parsed.detached, false);
  assert.equal(parsed.head_sha, "0123456789abcdef");
  assert.equal(parsed.ahead, 3);
  assert.equal(parsed.behind, 1);
  assert.equal(parsed.staged_count, 2);
  assert.equal(parsed.unstaged_count, 2);
  assert.equal(parsed.conflicted_count, 1);
  assert.equal(parsed.untracked_count, 1);
});

// 이 규칙이 깨지면 adopted worktree의 파일이나 미병합 브랜치, 관리 루트 밖 디렉터리가 삭제된다.
test("worktree remove enforces 3x provenance guard, dirty/session guards, and branch preservation", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-wt-test-"));
  try {
    const repoRoot = join(root, "repo");
    const gitCommon = join(repoRoot, ".git");
    const wtRoot = join(root, "worktrees");
    const adoptedDir = join(root, "external-wt");
    const managedDir = join(wtRoot, "repo-12345678", "feat-a-12345678");
    const escapedDir = join(root, "outside-root");
    await mkdir(join(gitCommon, "worktrees", "admin-managed"), {
      recursive: true,
    });
    await mkdir(adoptedDir, { recursive: true });
    await mkdir(managedDir, { recursive: true });
    await mkdir(escapedDir, { recursive: true });
    await writeFile(join(adoptedDir, "keep.txt"), "precious");
    await writeFile(
      join(managedDir, ".git"),
      `gitdir: ${join(gitCommon, "worktrees", "admin-managed")}\n`,
    );
    await writeFile(
      join(gitCommon, "worktrees", "admin-managed", "commondir"),
      "../..\n",
    );

    const rows = new Map<string, StoredWorktreeRow>();
    const makeRow = (
      id: Id<"wkt">,
      overrides: Partial<StoredWorktreeRow>,
    ): StoredWorktreeRow => ({
      id,
      project_id: PRJ,
      repo_root: repoRoot,
      git_common_dir: gitCommon,
      path: managedDir,
      git_admin_name: "admin-managed",
      label: "test",
      branch: "wt/test-1234",
      base_ref: "main",
      base_commit: "aaa111",
      provenance: "managed",
      status: "ready",
      idempotency_key: null,
      created_branch: true,
      managed_root: wtRoot,
      created_at: NOW,
      updated_at: NOW,
      ...overrides,
    });

    const adoptedId = "wkt_0000000000000000000000000a" as Id<"wkt">;
    const managedId = "wkt_0000000000000000000000000b" as Id<"wkt">;
    const escapedId = "wkt_0000000000000000000000000c" as Id<"wkt">;
    rows.set(
      adoptedId,
      makeRow(adoptedId, {
        path: adoptedDir,
        provenance: "adopted",
        branch: "ext/branch",
        created_branch: false,
      }),
    );
    rows.set(managedId, makeRow(managedId, {}));
    rows.set(
      escapedId,
      makeRow(escapedId, {
        path: escapedDir,
        provenance: "managed",
      }),
    );

    let dirtyFlag = true;
    let activeSessions: Id<"ses">[] = [];
    const gitCalls: Array<{ cwd: string; args: readonly string[] }> = [];

    const fakeGit: GitRunner = async (cwd, args) => {
      gitCalls.push({ cwd, args });
      if (args.includes("status")) {
        const lines = [
          "# branch.oid bbb222",
          "# branch.head wt/test-1234",
          ...(dirtyFlag ? ["? dirty.txt"] : []),
        ];
        return gitOk(lines.join("\0"));
      }
      if (args.includes("worktree") && args.includes("list")) {
        return gitOk(
          [
            `worktree ${repoRoot}`,
            "HEAD aaa111",
            "branch refs/heads/main",
            "",
            `worktree ${managedDir}`,
            "HEAD bbb222",
            "branch refs/heads/wt/test-1234",
            "",
          ].join("\n"),
        );
      }
      if (args.includes("worktree") && args.includes("remove")) {
        const target = args.at(-1);
        if (target) await rm(target, { recursive: true, force: true });
        return gitOk();
      }
      if (args.includes("rev-parse") && args.includes("--show-toplevel")) {
        return gitOk(`${cwd}\n${gitCommon}\n`);
      }
      if (args.includes("rev-parse")) return gitOk("bbb222\n");
      if (args.includes("update-ref")) return gitOk();
      if (args[0] === "branch" && args[1] === "-d") {
        return gitFail("error: The branch is not fully merged.", 1);
      }
      if (args.includes("merge-base")) return gitFail("", 1); // not merged
      if (args.includes("rev-list")) return gitOk("2\n");
      if (args.includes("submodule")) return gitOk("");
      if (args.includes("worktree") && args.includes("prune")) return gitOk();
      return gitOk();
    };

    const service = createWorktreeService({
      clock: FIXED_CLOCK,
      random: seededRandom(1),
      ids: createIdSource({ clock: FIXED_CLOCK, random: seededRandom(1) }),
      homeDir: "/home/nobody",
      defaultWorktreesRoot: wtRoot,
      configuredWorktreesRoot: () => wtRoot,
      projectFolders: () => ok([repoRoot]),
      loadProjectWorktrees: () => ok([...rows.values()]),
      loadWorktreeById: (id) => rows.get(id) ?? null,
      loadWorktreeByIdempotencyKey: () => null,
      loadWorktreesByStatuses: (statuses) =>
        [...rows.values()].filter((r) => statuses.includes(r.status)),
      loadSettings: () => ok(DEFAULT_WORKTREE_SETTINGS),
      upsert: async (_project, rec) => {
        rows.set(rec.id, {
          ...rec,
          idempotency_key: rec.idempotency_key ?? null,
          created_branch: rec.created_branch ?? false,
          managed_root: rec.managed_root ?? null,
        });
        return ok(undefined);
      },
      patch: async (_project, patch) => {
        const cur = rows.get(patch.id);
        if (cur) rows.set(patch.id, { ...cur, ...patch });
        return ok(undefined);
      },
      deleteRow: async (_project, id) => {
        rows.delete(id);
        return ok(undefined);
      },
      activity: {
        activeSessions: () => activeSessions,
        activeTerminals: () => [],
        stopSessionsAndTerminals: async () => {
          activeSessions = [];
          return ok(undefined);
        },
      },
      git: fakeGit,
      onChanged: () => {},
    });

    // 1. adopted remove ONLY untracks: disk files untouched, no `git worktree remove`
    const adoptedRes = await service.remove({
      worktree: adoptedId,
      force: true,
      deleteBranch: true,
    });
    assert.equal(adoptedRes.ok, true);
    if (adoptedRes.ok) {
      assert.equal(adoptedRes.value.untrack_only, true);
      assert.equal(adoptedRes.value.branch_deleted, false);
    }
    assert.equal(
      await readFile(join(adoptedDir, "keep.txt"), "utf8"),
      "precious",
    );
    assert.equal(
      gitCalls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove"),
      false,
    );

    // 2. managed outside worktreesRoot is hard-blocked even with force
    const escapedRes = await service.remove({
      worktree: escapedId,
      force: true,
    });
    assert.equal(escapedRes.ok, false);
    if (!escapedRes.ok) assert.equal(escapedRes.error.code, "forbidden");
    assert.ok(await stat(escapedDir));

    // 3. dirty managed worktree blocked without force
    const dirtyRes = await service.remove({ worktree: managedId });
    assert.equal(dirtyRes.ok, false);
    if (!dirtyRes.ok) {
      assert.equal(dirtyRes.error.code, "conflict");
      assert.equal(dirtyRes.error.details?.reason, "dirty_worktree");
    }

    // 4. active session blocked without stopSessions
    dirtyFlag = false;
    activeSessions = ["ses_00000000000000000000000001" as Id<"ses">];
    const activeRes = await service.remove({ worktree: managedId });
    assert.equal(activeRes.ok, false);
    if (!activeRes.ok) {
      assert.equal(activeRes.error.code, "conflict");
      assert.equal(activeRes.error.details?.reason, "active_sessions");
    }

    // 5. clean remove with stopSessions + deleteBranch on unmerged branch preserves branch safely
    const cleanRes = await service.remove({
      worktree: managedId,
      stopSessions: true,
      deleteBranch: true,
    });
    assert.equal(cleanRes.ok, true);
    if (cleanRes.ok) {
      assert.equal(cleanRes.value.untrack_only, false);
      assert.equal(cleanRes.value.branch_deleted, false);
      assert.equal(cleanRes.value.preserved_branch?.name, "wt/test-1234");
    }
    assert.equal(rows.get(managedId)?.status, "removed");

    // 6. persisted managed_root still validates ownership after configured root changes across restart
    const oldRoot = join(root, "old-worktrees");
    const oldManagedDir = join(oldRoot, "repo-12345678", "feat-old-12345678");
    const newRoot = join(root, "new-worktrees");
    await mkdir(oldManagedDir, { recursive: true });
    await writeFile(
      join(oldManagedDir, ".git"),
      `gitdir: ${join(gitCommon, "worktrees", "admin-managed")}\n`,
    );
    const oldId = "wkt_0000000000000000000000000d" as Id<"wkt">;
    rows.set(
      oldId,
      makeRow(oldId, {
        path: oldManagedDir,
        managed_root: oldRoot,
      }),
    );
    const restartedService = createWorktreeService({
      clock: FIXED_CLOCK,
      random: seededRandom(1),
      ids: createIdSource({ clock: FIXED_CLOCK, random: seededRandom(1) }),
      homeDir: "/home/nobody",
      defaultWorktreesRoot: join(root, "default-worktrees"),
      configuredWorktreesRoot: () => newRoot,
      projectFolders: () => ok([repoRoot]),
      allProjectFolders: () => [repoRoot, join(root, "other-project")],
      loadProjectWorktrees: () => ok([...rows.values()]),
      loadWorktreeById: (id) => rows.get(id) ?? null,
      loadWorktreeByIdempotencyKey: () => null,
      loadWorktreesByStatuses: (statuses) =>
        [...rows.values()].filter((r) => statuses.includes(r.status)),
      loadSettings: () => ok(DEFAULT_WORKTREE_SETTINGS),
      upsert: async () => ok(undefined),
      patch: async (_project, patch) => {
        const cur = rows.get(patch.id);
        if (cur) rows.set(patch.id, { ...cur, ...patch });
        return ok(undefined);
      },
      deleteRow: async (_project, id) => {
        rows.delete(id);
        return ok(undefined);
      },
      activity: {
        activeSessions: () => [],
        activeTerminals: () => [],
        stopSessionsAndTerminals: async () => ok(undefined),
      },
      git: fakeGit,
      onChanged: () => {},
    });
    const removedAfterRestart = await restartedService.remove({
      worktree: oldId,
    });
    assert.equal(removedAfterRestart.ok, true);
    assert.equal(rows.get(oldId)?.status, "removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 이 규칙이 깨지면 tracked 파일이나 기존 목적지 파일이 복사 시 덮어씌워진다.
test("copyGitignoredFiles only copies git-ignored files and never overwrites existing destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-wt-copy-"));
  try {
    const repo = join(root, "repo");
    const wt = join(root, "wt");
    await mkdir(repo, { recursive: true });
    await mkdir(wt, { recursive: true });
    await writeFile(join(repo, ".env"), "SECRET=from_repo");
    await writeFile(join(repo, ".env.local"), "LOCAL=from_repo");
    await writeFile(join(repo, "tracked.txt"), "tracked");
    await writeFile(join(wt, ".env.local"), "KEEP_EXISTING");

    // fake git check-ignore reports only .env and .env.local as ignored (not tracked.txt)
    const fakeGit: GitRunner = async (_cwd, args) => {
      if (args[0] === "check-ignore") {
        return gitOk(".env\0.env.local\0");
      }
      return gitOk();
    };

    const res = await copyGitignoredFiles({
      repoRoot: repo,
      worktreePath: wt,
      patterns: [".env*", "tracked.txt", "../escape.txt", ".git/config"],
      git: fakeGit,
    });
    assert.equal(res.copied, 1);
    assert.equal(await readFile(join(wt, ".env"), "utf8"), "SECRET=from_repo");
    assert.equal(
      await readFile(join(wt, ".env.local"), "utf8"),
      "KEEP_EXISTING",
    );
    await assert.rejects(() => stat(join(wt, "tracked.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 이 규칙이 깨지면 생성 중 크래시한 creating 레코드가 고아로 남는다.
test("recoverOnStartup cleans up creating rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-wt-recover-"));
  try {
    const repoRoot = join(root, "repo");
    const gitCommon = join(repoRoot, ".git");
    const wtRoot = join(root, "worktrees");
    const partialDir = join(wtRoot, "repo-12345678", "wt-crash-12345678");
    await mkdir(gitCommon, { recursive: true });
    await mkdir(partialDir, { recursive: true });
    await writeFile(join(partialDir, "half.txt"), "partial");

    const crashId = "wkt_00000000000000000000000099" as Id<"wkt">;
    const rows = new Map<string, StoredWorktreeRow>([
      [
        crashId,
        {
          id: crashId,
          project_id: PRJ,
          repo_root: repoRoot,
          git_common_dir: gitCommon,
          path: partialDir,
          git_admin_name: null,
          label: "crash",
          branch: "wt/crash-1234",
          base_ref: "main",
          base_commit: "aaa111",
          provenance: "managed",
          status: "creating",
          idempotency_key: null,
          created_branch: true,
          managed_root: wtRoot,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    ]);

    const fakeGit: GitRunner = async (_cwd, args) => {
      if (args[0] === "rev-parse") return gitOk("aaa111\n");
      return gitOk();
    };

    const service = createWorktreeService({
      clock: FIXED_CLOCK,
      random: seededRandom(2),
      ids: createIdSource({ clock: FIXED_CLOCK, random: seededRandom(2) }),
      homeDir: "/home/nobody",
      defaultWorktreesRoot: wtRoot,
      configuredWorktreesRoot: () => wtRoot,
      projectFolders: () => ok([repoRoot]),
      loadProjectWorktrees: () => ok([...rows.values()]),
      loadWorktreeById: (id) => rows.get(id) ?? null,
      loadWorktreeByIdempotencyKey: () => null,
      loadWorktreesByStatuses: (statuses) =>
        [...rows.values()].filter((r) => statuses.includes(r.status)),
      loadSettings: () => ok(DEFAULT_WORKTREE_SETTINGS),
      upsert: async () => ok(undefined),
      patch: async () => ok(undefined),
      deleteRow: async (_project, id) => {
        rows.delete(id);
        return ok(undefined);
      },
      activity: {
        activeSessions: () => [],
        activeTerminals: () => [],
        stopSessionsAndTerminals: async () => ok(undefined),
      },
      git: fakeGit,
      onChanged: () => {},
    });

    await service.recoverOnStartup();
    assert.equal(rows.has(crashId), false);
    await assert.rejects(() => stat(partialDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
