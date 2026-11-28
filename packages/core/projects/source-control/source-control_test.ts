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

const USER_CTX: AuthenticatedContext = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};

const AGENT_CTX: AuthenticatedContext = {
  principal: "agent:ses_00000000000000000000000001",
  actor: "agent:ses_00000000000000000000000001",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "agent:ses_00000000000000000000000001",
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
    let authFail = false;
    const recordedCalls: Array<{ cwd: string; args: readonly string[] }> = [];

    const fakeGit: GitRunner = async (cwd, args) => {
      recordedCalls.push({ cwd, args });
      if (args[0] === "rev-parse" && args.includes("--show-toplevel")) {
        return gitOk(`${repo}\n${gitDir}\n`);
      }
      if (args[0] === "rev-parse" && args.includes("--git-dir")) {
        return gitOk(`${gitDir}\n`);
      }
      if (args[0] === "symbolic-ref") {
        return gitOk("main\n");
      }
      if (args[0] === "status") {
        const lines = [
          "# branch.oid aaa111",
          "# branch.head main",
          ...(stagedUnmerged
            ? ["u UU N... 100644 100644 100644 100644 a b c conflict.ts"]
            : ["1 M. N... 100644 100644 100644 a b ok.ts"]),
        ];
        return gitOk(lines.join("\0"));
      }
      if (
        args[0] === "diff" &&
        args.includes("--cached") &&
        args.includes("--name-only")
      ) {
        return gitOk("ok.ts\0");
      }
      if (args[0] === "show" && args[1]?.startsWith(":")) {
        return gitOk(
          conflictMarker
            ? "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n"
            : "clean content\n",
        );
      }
      if (args[0] === "pull") {
        if (authFail) {
          return gitFail(
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            128,
          );
        }
        return gitOk("Already up to date.\n");
      }
      if (args[0] === "push") {
        if (authFail) {
          return gitFail("Permission denied (publickey).", 128);
        }
        return gitOk("");
      }
      if (args[0] === "switch") return gitOk("");
      if (args[0] === "commit") return gitOk("[main bbb222] test\n");
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return gitOk("bbb222\n");
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
      git: fakeGit,
    });

    const target = { project: PRJ, folder: repo };

    // 1. agent cannot call write routes
    const agentCommit = await handlers.commit(AGENT_CTX, {
      ...target,
      message: "agent attempt",
    });
    assert.equal(agentCommit.ok, false);
    if (!agentCommit.ok) assert.equal(agentCommit.error.code, "forbidden");

    // 2. commit rejected when MERGE_HEAD exists
    await writeFile(join(gitDir, "MERGE_HEAD"), "123456\n");
    const mergeCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "during merge",
    });
    assert.equal(mergeCommit.ok, false);
    if (!mergeCommit.ok) assert.equal(mergeCommit.error.code, "conflict");
    await rm(join(gitDir, "MERGE_HEAD"));

    // 3. commit rejected when unmerged entries exist
    stagedUnmerged = true;
    const unmergedCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "unmerged",
    });
    assert.equal(unmergedCommit.ok, false);
    if (!unmergedCommit.ok) assert.equal(unmergedCommit.error.code, "conflict");
    stagedUnmerged = false;

    // 4. commit rejected when conflict markers appear in staged content
    conflictMarker = true;
    const markerCommit = await handlers.commit(USER_CTX, {
      ...target,
      message: "markers",
    });
    assert.equal(markerCommit.ok, false);
    if (!markerCommit.ok) assert.equal(markerCommit.error.code, "conflict");
    conflictMarker = false;

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
