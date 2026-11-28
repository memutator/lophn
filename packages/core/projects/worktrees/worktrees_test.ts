import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  loadActiveWorktreeRoots,
  loadManagedReadyWorktrees,
  parsePorcelainV2Z,
  redactGitUrlCredentials,
  safeRealpath,
  type StoredWorktreeRow,
  validateWorktreesRoot,
  WORKTREES_SCHEMA_STEPS,
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

// 이 규칙이 깨지면 미생성 경로의 부모 symlink 우회나 미검증 worktrees_folder 설정이
// 3중 소유권·folderOfCwd 안전 루트 경계를 뚫는다.
test("safeRealpath resolves ancestor symlinks and unvalidated worktrees_folder never widens ownership or managed ready lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-wt-root-guard-"));
  try {
    const repoRoot = join(root, "repo");
    const gitCommon = join(repoRoot, ".git");
    const wtRoot = join(root, "worktrees");
    const outsideDir = join(root, "outside-dir");
    const linkToRepo = join(root, "link-to-repo");
    await mkdir(join(gitCommon, "worktrees", "admin-out"), { recursive: true });
    await mkdir(wtRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(repoRoot, linkToRepo);

    // 1. 아직 존재하지 않는 하위 경로라도 부모 symlink가 풀려 repo 내부 우회가 차단된다.
    const futureUnderLink = join(linkToRepo, "not-yet-created", "wt");
    assert.equal(
      safeRealpath(futureUnderLink),
      join(safeRealpath(repoRoot), "not-yet-created", "wt"),
    );
    assert.equal(
      validateWorktreesRoot(futureUnderLink, {
        homeDir: "/home/nobody",
        repoRoots: [repoRoot],
      }).ok,
      false,
    );

    // 2. 위험한 worktrees_folder(예: 저장소 상위인 root)로 create가 거절되어도
    //    그 미검증 경로가 knownManagedRoots에 남아 remove 3중 소유권 검증을 통과하면 안 된다.
    await writeFile(
      join(outsideDir, ".git"),
      `gitdir: ${join(gitCommon, "worktrees", "admin-out")}\n`,
    );
    await writeFile(
      join(gitCommon, "worktrees", "admin-out", "commondir"),
      "../..\n",
    );
    const outId = "wkt_00000000000000000000000088" as Id<"wkt">;
    const rows = new Map<string, StoredWorktreeRow>([
      [
        outId,
        {
          id: outId,
          project_id: PRJ,
          repo_root: repoRoot,
          git_common_dir: gitCommon,
          path: outsideDir,
          git_admin_name: "admin-out",
          label: "out",
          branch: "wt/out",
          base_ref: "main",
          base_commit: "aaa111",
          provenance: "managed",
          status: "ready",
          idempotency_key: null,
          created_branch: false,
          managed_root: root,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    ]);
    let configuredRoot = root; // repoRoot의 상위 디렉터리(위험 경로)
    const fakeGit: GitRunner = async (_cwd, args) => {
      if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
        return gitOk(`${repoRoot}\n${gitCommon}\nfalse\n`);
      }
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        return gitOk("aaa111\n");
      }
      return gitOk();
    };
    const service = createWorktreeService({
      clock: FIXED_CLOCK,
      random: seededRandom(3),
      ids: createIdSource({ clock: FIXED_CLOCK, random: seededRandom(3) }),
      homeDir: "/home/nobody",
      defaultWorktreesRoot: wtRoot,
      configuredWorktreesRoot: () => configuredRoot,
      projectFolders: () => ok([repoRoot]),
      allProjectFolders: () => [repoRoot],
      loadProjectWorktrees: () => ok([...rows.values()]),
      loadWorktreeById: (id) => rows.get(id) ?? null,
      loadWorktreeByIdempotencyKey: () => null,
      loadWorktreesByStatuses: () => [],
      loadSettings: () => ok(DEFAULT_WORKTREE_SETTINGS),
      upsert: async () => ok(undefined),
      patch: async () => ok(undefined),
      deleteRow: async () => ok(undefined),
      activity: {
        activeSessions: () => [],
        activeTerminals: () => [],
        stopSessionsAndTerminals: async () => ok(undefined),
      },
      git: fakeGit,
      onChanged: () => {},
    });

    const createBlocked = await service.create({
      project: PRJ,
      branch: "wt/should-fail",
    });
    assert.equal(createBlocked.ok, false);
    if (!createBlocked.ok) {
      assert.equal(createBlocked.error.code, "invalid_input");
    }

    // 설정을 정상 경로로 돌려놓은 뒤에도 이전 위험 경로가 knownManagedRoots에 남아 있으면 안 된다.
    configuredRoot = wtRoot;
    const removeBlocked = await service.remove({
      worktree: outId,
      force: true,
    });
    assert.equal(removeBlocked.ok, false);
    if (!removeBlocked.ok) {
      assert.equal(removeBlocked.error.code, "forbidden");
    }

    // 3. loadManagedReadyWorktrees도 미검증 managedRoot·row.managed_root를 거부한다.
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        create table projects (id text primary key);
        create table sessions (id text primary key);
        insert into projects values ('${PRJ}');
      `);
      db.exec(WORKTREES_SCHEMA_STEPS[0]!.sql);
      db.prepare(
        `INSERT INTO project_worktrees (
          id, project_id, repo_root, git_common_dir, path, git_admin_name,
          label, branch, base_ref, base_commit, provenance, status,
          idempotency_key, created_branch, managed_root, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        outId,
        PRJ,
        repoRoot,
        gitCommon,
        outsideDir,
        "admin-out",
        "out",
        "wt/out",
        "main",
        "aaa111",
        "managed",
        "ready",
        null,
        0,
        root, // 위험한 managed_root (repoRoot의 상위)
        NOW,
        NOW,
      );
      const sql = {
        all: (text: string, params: never[]) =>
          db.prepare(text).all(...params) as Record<string, never>[],
      };
      const loaded = loadManagedReadyWorktrees(sql, PRJ, "/", {
        homeDir: "/home/nobody",
        repoRoots: [repoRoot],
      });
      assert.deepStrictEqual(loaded, []);
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// shell 파일 adapter의 범위다. 보관한 project의 worktree나 ready가 아닌 worktree가 열리면 등록 폴더 밖을 읽고 쓰고 지운다.
test("only ready worktrees of active projects are file roots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const archived = "prj_00000000000000000000000002";
    db.exec(`
      create table projects (id text primary key, status text);
      create table sessions (id text primary key);
      insert into projects values ('${PRJ}', 'active'), ('${archived}', 'archived');
    `);
    db.exec(WORKTREES_SCHEMA_STEPS[0]!.sql);
    const insert = db.prepare(
      `INSERT INTO project_worktrees (
        id, project_id, repo_root, git_common_dir, path, git_admin_name,
        label, branch, base_ref, base_commit, provenance, status,
        idempotency_key, created_branch, managed_root, created_at, updated_at
      ) VALUES (?, ?, '/r', '/r/.git', ?, ?, 'l', null, null, null, 'managed', ?, null, 0, '/w', ?, ?)`,
    );
    const wkt = (n: number) => `wkt_${String(n).padStart(26, "0")}`;
    insert.run(wkt(1), PRJ, "/w/one", "a1", "ready", NOW, NOW);
    insert.run(wkt(2), PRJ, "/w/two", "a2", "missing", NOW, NOW);
    insert.run(wkt(3), archived, "/w/three", "a3", "ready", NOW, NOW);
    const sql = {
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    };
    assert.deepStrictEqual(loadActiveWorktreeRoots(sql), [
      { project: PRJ, worktree: wkt(1), path: "/w/one" },
    ]);
  } finally {
    db.close();
  }
});
