import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { GitRunner, GitRunResult } from "../worktrees/mod.ts";
import { createSourceControlHandlers } from "./mod.ts";

const PRJ = "prj_00000000000000000000000001" as Id<"prj">;
const OTHER_PRJ = "prj_00000000000000000000000002" as Id<"prj">;
const SES_SAME = "ses_00000000000000000000000001" as Id<"ses">;
const SES_OTHER = "ses_00000000000000000000000002" as Id<"ses">;

const USER_CTX: AuthenticatedContext = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};

const AGENT_CTX: AuthenticatedContext = {
  principal: `agent:${SES_SAME}`,
  actor: `agent:${SES_SAME}`,
  scope: { operations: [], targets: {} },
  conditions: { session: SES_SAME, project: PRJ },
  credential_ref: `agent:${SES_SAME}`,
};

const OTHER_PROJECT_AGENT_CTX: AuthenticatedContext = {
  principal: `agent:${SES_OTHER}`,
  actor: `agent:${SES_OTHER}`,
  scope: { operations: [], targets: {} },
  conditions: { session: SES_OTHER },
  credential_ref: `agent:${SES_OTHER}`,
};

function gitOk(stdout = "", stderr = ""): GitRunResult {
  return { code: 0, stdout, stderr, timedOut: false, notFound: false };
}

function gitFail(stderr: string, code = 1): GitRunResult {
  return { code, stdout: "", stderr, timedOut: false, notFound: false };
}

// spec 3.4.2 불변식: 충돌 상태·마커 커밋 거부, 활성 turn 중 switch 거부, pull --ff-only,
// force push 없음, auth 실패 -> unauthorized + 1줄 명령, agent 쓰기 -> forbidden.
test("source_control enforces user-only writes, conflict commit guard, active-turn switch guard, ff-only pull, and auth handling", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-sc-test-"));
  try {
    const repo = join(root, "repo");
    const gitDir = join(repo, ".git");
    await mkdir(gitDir, { recursive: true });

    let activeTurn = false;
    let stagedUnmerged = false;
    let conflictMarker = false;
    let standaloneEquals = false;
    let authFail = false;
    const recordedCalls: Array<{ cwd: string; args: readonly string[] }> = [];

    const fakeGit: GitRunner = async (cwd, args) => {
      recordedCalls.push({ cwd, args });
      const cmdArgs = args[0] === "--no-optional-locks" ? args.slice(1) : args;
      if (
        cmdArgs[0] === "rev-parse" &&
        cmdArgs.includes("--is-bare-repository")
      ) {
        return gitOk("false\n");
      }
      if (cmdArgs[0] === "rev-parse" && cmdArgs.includes("--show-toplevel")) {
        return gitOk(`${repo}\n`);
      }
      if (
        cmdArgs[0] === "rev-parse" &&
        (cmdArgs.includes("--git-common-dir") || cmdArgs.includes("--git-dir"))
      ) {
        return gitOk(`${gitDir}\n`);
      }
      if (cmdArgs[0] === "symbolic-ref") {
        return gitOk("main\n");
      }
      if (cmdArgs[0] === "status") {
        const lines = [
          "# branch.oid aaa111",
          "# branch.head main",
          ...(stagedUnmerged
            ? ["u UU N... 100644 100644 100644 100644 a b c conflict.ts"]
            : ["1 M. N... 100644 100644 100644 a b ok.ts"]),
        ];
        return gitOk(lines.join("\0"));
      }
      if (cmdArgs[0] === "diff" && cmdArgs.includes("--cached")) {
        if (conflictMarker) {
          return gitOk(
            [
              "diff --git a/ok.ts b/ok.ts",
              "--- a/ok.ts",
              "+++ b/ok.ts",
              "@@ -1 +1,5 @@",
              "+<<<<<<< HEAD",
              "+a",
              "+=======",
              "+b",
              "+>>>>>>> other",
              "",
            ].join("\n"),
          );
        }
        if (standaloneEquals) {
          return gitOk(
            [
              "diff --git a/README.md b/README.md",
              "--- a/README.md",
              "+++ b/README.md",
              "@@ -0,0 +1,2 @@",
              "+Title",
              "+=======",
              "",
            ].join("\n"),
          );
        }
        return gitOk(
          "diff --git a/ok.ts b/ok.ts\n--- a/ok.ts\n+++ b/ok.ts\n@@ -1 +1 @@\n+clean content\n",
        );
      }
      if (cmdArgs[0] === "diff") {
        return gitOk("diff --git a/ok.ts b/ok.ts\n+change\n");
      }
      if (cmdArgs[0] === "log") {
        return gitOk(
          `aaa1111\x1faaa1111\x1f\x1fDev\x1fdev@example.com\x1f2026-11-28T00:00:00Z\x1fHEAD -> main\x1finit\x1e`,
        );
      }
      if (cmdArgs[0] === "show") {
        if (cmdArgs.includes("--no-patch")) {
          return gitOk(
            `aaa1111\x1faaa1111\x1f\x1fDev\x1fdev@example.com\x1f2026-11-28T00:00:00Z\x1f\x1finit\x1fbody`,
          );
        }
        return gitOk("");
      }
      if (cmdArgs[0] === "worktree" && cmdArgs[1] === "list") {
        return gitOk(
          `worktree ${repo}\nHEAD aaa1111\nbranch refs/heads/main\n\n`,
        );
      }
      if (cmdArgs[0] === "for-each-ref") {
        return gitOk(`refs/heads/main\x1fmain\x1faaa1111\x1f\x1f\n`);
      }
      if (cmdArgs[0] === "pull") {
        if (authFail) {
          return gitFail(
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            128,
          );
        }
        return gitOk("Already up to date.\n");
      }
      if (cmdArgs[0] === "push") {
        if (authFail) {
          return gitFail("Permission denied (publickey).", 128);
        }
        return gitOk("");
      }
      if (cmdArgs[0] === "remote") return gitOk("origin\n");
      if (cmdArgs[0] === "switch") return gitOk("");
      if (cmdArgs[0] === "commit") return gitOk("[main bbb222] test\n");
      if (cmdArgs[0] === "rev-parse" && cmdArgs[1] === "HEAD") {
        return gitOk("bbb222\n");
      }
      if (cmdArgs[0] === "rev-parse" && cmdArgs.includes("--verify")) {
        return gitOk("aaa111\n");
      }
      return gitOk();
    };

    const handlers = createSourceControlHandlers({
      projectFolders: () => ok([repo]),
      resolveReadyWorktree: () =>
        err({ code: "not_found", message: "no worktree" }),
      hasActiveTurnInCheckout: () => activeTurn,
      isDevice: () => false,
      granted: () => false,
      sessionProject: async (session) =>
        ok(session === SES_SAME ? PRJ : OTHER_PRJ),
      git: fakeGit,
    });

    const target = { project: PRJ, folder: repo };

    // 0. agent cannot read another project's source control, but can read its own project
    const crossReads = await Promise.all([
      handlers.status(OTHER_PROJECT_AGENT_CTX, target),
      handlers.diff(OTHER_PROJECT_AGENT_CTX, target),
      handlers.log(OTHER_PROJECT_AGENT_CTX, target),
      handlers.show(OTHER_PROJECT_AGENT_CTX, { ...target, sha: "aaa1111" }),
      handlers.branches(OTHER_PROJECT_AGENT_CTX, target),
    ]);
    for (const res of crossReads) {
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "forbidden");
        assert.equal(res.error.details?.reason, "cross_project");
      }
    }
    const ownStatus = await handlers.status(AGENT_CTX, target);
    assert.equal(ownStatus.ok, true);
    if (ownStatus.ok) {
      assert.equal(
        (ownStatus.value as { can_write: boolean }).can_write,
        false,
      );
    }

    // 1. agent cannot call write routes
    const agentCommit = await handlers.commit(AGENT_CTX, {
      ...target,
      message: "agent attempt",
    });
    assert.equal(agentCommit.ok, false);
    if (!agentCommit.ok) assert.equal(agentCommit.error.code, "forbidden");

    // 2. rebase in progress refuses commit; a merge with every conflict resolved is finished by commit (Complete Merge)
    await mkdir(join(gitDir, "rebase-merge"));
    const rebaseCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "during rebase",
    });
    assert.equal(rebaseCommit.ok, false);
    if (!rebaseCommit.ok) {
      assert.equal(rebaseCommit.error.details?.reason, "operation_in_progress");
    }
    await rm(join(gitDir, "rebase-merge"), { recursive: true });
    await writeFile(join(gitDir, "MERGE_HEAD"), "123456\n");
    stagedUnmerged = true;
    const unresolvedMerge = await handlers.commit(USER_CTX, {
      ...target,
      message: "during merge",
    });
    assert.equal(unresolvedMerge.ok, false);
    stagedUnmerged = false;
    const finishedMerge = await handlers.commit(USER_CTX, {
      ...target,
      message: "merge done",
    });
    assert.equal(finishedMerge.ok, true);
    await rm(join(gitDir, "MERGE_HEAD"));

    // 3. commit rejected when unmerged entries exist
    stagedUnmerged = true;
    const unmergedCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "unmerged",
    });
    assert.equal(unmergedCommit.ok, false);
    if (!unmergedCommit.ok) {
      assert.equal(unmergedCommit.error.code, "conflict");
      assert.equal(
        unmergedCommit.error.details?.reason,
        "unresolved_conflicts",
      );
    }
    stagedUnmerged = false;

    // 4. commit rejected when conflict markers appear in staged content
    conflictMarker = true;
    const markerCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "markers",
    });
    assert.equal(markerCommit.ok, false);
    if (!markerCommit.ok) {
      assert.equal(markerCommit.error.code, "conflict");
      assert.equal(markerCommit.error.details?.reason, "conflict_markers");
    }
    conflictMarker = false;

    // 4b. standalone ======= line (e.g. Markdown setext heading) is NOT rejected as conflict marker
    standaloneEquals = true;
    const markdownCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "docs heading",
    });
    assert.equal(markdownCommit.ok, true);
    standaloneEquals = false;

    // 5. switch rejected while active turn runs in checkout
    activeTurn = true;
    const blockedSwitch = await handlers.switchBranch(USER_CTX, {
      ...target,
      branch: "other",
    });
    assert.equal(blockedSwitch.ok, false);
    if (!blockedSwitch.ok) {
      assert.equal(blockedSwitch.error.code, "conflict");
    }
    activeTurn = false;

    // 6. pull always uses --ff-only and push never uses --force
    recordedCalls.length = 0;
    const pulled = await handlers.pull(USER_CTX, {
      ...target,
    });
    assert.equal(pulled.ok, true);
    const pullCall = recordedCalls.find((c) => c.args[0] === "pull");
    assert.ok(pullCall?.args.includes("--ff-only"));

    recordedCalls.length = 0;
    const pushed = await handlers.push(USER_CTX, {
      ...target,
    });
    assert.equal(pushed.ok, true);
    const pushCall = recordedCalls.find((c) => c.args[0] === "push");
    assert.ok(pushCall !== undefined);
    assert.ok(
      !pushCall!.args.some(
        (a) =>
          a === "--force" || a === "-f" || a.startsWith("--force-with-lease"),
      ),
    );

    // 7. auth failure returns unauthorized + 1-line git -C command
    authFail = true;
    const pushAuth = await handlers.push(USER_CTX, {
      ...target,
    });
    assert.equal(pushAuth.ok, false);
    if (!pushAuth.ok) {
      assert.equal(pushAuth.error.code, "unauthorized");
      assert.ok(
        typeof pushAuth.error.details?.command === "string" &&
          pushAuth.error.details.command.includes("git -C"),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 새 쓰기 route의 데이터 보호: 브랜치 지우기는 `-d`뿐이고 병합되지 않았으면 남긴다, 마커가 남은 파일은 해결로 표시하지 않는다,
// 미추적 중첩 저장소(gitlink)는 커밋하지 않는다, agent turn이 도는 체크아웃에서 전체 버리기를 하지 않는다.
test("source_control keeps unmerged branches, marked files, nested repos and running-turn checkouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-sc-guard-"));
  try {
    const repo = join(root, "repo");
    const gitDir = join(repo, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(
      join(repo, "conflict.ts"),
      "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n",
    );
    const calls: (readonly string[])[] = [];
    const fakeGit: GitRunner = async (_cwd, args) => {
      calls.push(args);
      const cmd = args.filter(
        (a) => a !== "--no-optional-locks" && a !== "--literal-pathspecs",
      );
      if (cmd[0] === "rev-parse" && cmd.includes("--is-bare-repository")) {
        return gitOk("false\n");
      }
      if (cmd[0] === "rev-parse" && cmd.includes("--show-toplevel")) {
        return gitOk(`${repo}\n`);
      }
      if (
        cmd[0] === "rev-parse" &&
        (cmd.includes("--git-common-dir") || cmd.includes("--git-dir"))
      ) {
        return gitOk(`${gitDir}\n`);
      }
      if (cmd[0] === "worktree" && cmd[1] === "list") {
        return gitOk(
          `worktree ${repo}\nHEAD aaa1111\nbranch refs/heads/main\n\n`,
        );
      }
      if (cmd[0] === "branch" && cmd[1] === "-d") {
        return gitFail(
          "error: The branch 'feature' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D feature'.",
        );
      }
      if (cmd[0] === "status") {
        return gitOk(
          [
            "# branch.oid aaa111",
            "# branch.head main",
            "1 A. N... 000000 160000 160000 a b vendor/lib",
          ].join("\0"),
        );
      }
      if (cmd[0] === "diff" && cmd.includes("--raw")) {
        return gitOk(":000000 160000 0000000 abcdef1 A\0vendor/lib\0");
      }
      if (cmd[0] === "config") return gitFail("", 1);
      return gitOk();
    };
    const handlers = createSourceControlHandlers({
      projectFolders: () => ok([repo]),
      resolveReadyWorktree: () => err({ code: "not_found", message: "none" }),
      hasActiveTurnInCheckout: () => true,
      isDevice: () => false,
      granted: () => false,
      sessionProject: async () => ok(PRJ),
      git: fakeGit,
    });
    const target = { project: PRJ, folder: repo };

    const deleted = await handlers.branchDelete(USER_CTX, {
      ...target,
      name: "feature",
    });
    assert.equal(deleted.ok, false);
    if (!deleted.ok) assert.equal(deleted.error.details?.reason, "unmerged");
    assert.ok(
      !calls.some((args) => args.includes("-D") || args.includes("--force")),
    );

    const resolved = await handlers.markResolved(USER_CTX, {
      ...target,
      paths: ["conflict.ts"],
    });
    assert.equal(resolved.ok, false);
    if (!resolved.ok)
      assert.equal(resolved.error.details?.reason, "conflict_markers");
    assert.ok(!calls.some((args) => args.includes("add")));

    const committed = await handlers.commit(USER_CTX, {
      ...target,
      message: "vendor",
    });
    assert.equal(committed.ok, false);
    if (!committed.ok)
      assert.equal(committed.error.details?.reason, "nested_repository");
    assert.ok(!calls.some((args) => args[0] === "commit"));

    const discarded = await handlers.discard(USER_CTX, {
      ...target,
      all: true,
    });
    assert.equal(discarded.ok, false);
    if (!discarded.ok)
      assert.equal(discarded.error.details?.reason, "active_agent");
    assert.ok(
      !calls.some(
        (args) => args.includes("checkout") || args.includes("clean"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
