import assert from "node:assert/strict";
import { test } from "node:test";
import { ok, type Result } from "../../base/mod.ts";
import {
  codingSessionsList,
  codingSessionsOpen,
} from "../../protocol/coding-agent/relay.ts";
import { HOME_TERMINAL_PROJECT } from "../../protocol/coding-agent/terminals.ts";
import type { WorkflowOrigin } from "../../protocol/workflows/values.ts";
import { type CodingOpenDeps, createCodingOpen } from "./open.ts";

const PROJECT = `prj_${"0".repeat(26)}`;
const WORKFLOW_PROJECT = `prj_${"9".repeat(26)}`;
const INSTANCE = `wfi_${"7".repeat(26)}`;
const LEDGER = `ses_${"1".repeat(26)}`;
const TERMINAL = `trm_${"2".repeat(26)}`;

function setup(
  listed: { harness: string; cli_session: string | null }[],
  guiOn = true,
  commands: Record<string, string> = {},
) {
  const calls: unknown[] = [];
  const holds: string[] = [];
  const deps: CodingOpenDeps = {
    guiOn: () => guiOn,
    open(project, command, tab) {
      calls.push({ project, command, ...(tab === undefined ? {} : { tab }) });
      return Promise.resolve(ok(TERMINAL) as Result<string>);
    },
    session: (session) =>
      session === LEDGER
        ? { project: PROJECT, harness: "claude", cli_session: "cli-1" }
        : undefined,
    listed: () => listed,
    hold(session) {
      holds.push(session);
      return ok({});
    },
    held: () => {},
    codingCommand: (harness) => commands[harness],
  };
  return { opener: createCodingOpen(deps), calls, holds };
}

// 한 CLI session에 process 둘이 붙으면 대화 기록이 엇갈려 망가진다.
test("이미 다른 탭에서 도는 CLI session을 resume으로 열면 conflict이고 터미널이 열리지 않는다", async () => {
  const { opener, calls, holds } = setup([
    { harness: "claude", cli_session: "cli-1" },
  ]);
  const done = await opener.open({
    project: PROJECT,
    harness: "claude",
    resume: { session: LEDGER },
    key: "k1",
  });
  assert.equal(done.ok, false);
  assert.equal(!done.ok && done.error.code, "conflict");
  assert.deepEqual(calls, []);
  assert.deepEqual(holds, []);
});

// 폰은 다시 붙은 뒤 같은 key로 다시 보낸다. 컴퓨터에 터미널 탭이 둘 생기면 안 된다.
test("같은 key의 open은 터미널을 한 번만 열고 같은 session을 돌려준다", async () => {
  const { opener, calls } = setup([]);
  const input = { project: PROJECT, harness: "codex", key: "k2" };
  const [first, second] = await Promise.all([
    opener.open(input),
    opener.open(input),
  ]);
  assert.deepEqual(first, ok({ session: `ses_${"2".repeat(26)}` }));
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
});

// GUI가 서지 않는 터미널을 열면 폰은 한참 기다린 뒤에야 실패를 안다.
test("GUI handler가 준비되지 않았으면 unavailable로 곧 실패하고 터미널도 hold도 열지 않는다", async () => {
  const { opener, calls, holds } = setup([], false);
  const done = await opener.open({
    project: PROJECT,
    harness: "claude",
    resume: { session: LEDGER },
    key: "k3",
  });
  assert.equal(done.ok, false);
  assert.equal(!done.ok && done.error.code, "unavailable");
  assert.equal(!done.ok && done.error.details, undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(holds, []);
});

test("Home(project: home) coding session도 schema와 open이 받고 터미널을 연다", async () => {
  assert.ok(
    codingSessionsList.input.safeParse({ project: HOME_TERMINAL_PROJECT })
      .success,
  );
  assert.ok(
    codingSessionsOpen.input.safeParse({
      project: HOME_TERMINAL_PROJECT,
      harness: "claude",
      key: "k-home",
    }).success,
  );
  const { opener, calls } = setup([]);
  const done = await opener.open({
    project: HOME_TERMINAL_PROJECT,
    harness: "claude",
    key: "k-home",
  });
  assert.deepEqual(done, ok({ session: `ses_${"2".repeat(26)}` }));
  assert.deepEqual(calls, [
    { project: HOME_TERMINAL_PROJECT, command: "claude --gui" },
  ]);
});

test("coding_sessions/open applies saved coding agent flags without duplicating --gui", async () => {
  const { opener, calls } = setup([], true, {
    antigravity: "agy --dangerously-skip-permissions",
    claude: "claude --gui --model opus",
  });
  await opener.open({
    project: PROJECT,
    harness: "antigravity",
    key: "k-agy",
  });
  await opener.open({
    project: PROJECT,
    harness: "claude",
    resume: { session: LEDGER },
    key: "k-claude",
  });
  assert.deepEqual(calls, [
    {
      project: PROJECT,
      command: "agy --dangerously-skip-permissions --gui",
    },
    {
      project: PROJECT,
      command: "claude --gui --model opus --resume cli-1",
    },
  ]);
});

// 탭이 없는 GUI 탭 팀원에게 입력이 오면 core가 그 project에 터미널을 열어 그 CLI session을 잇거나(있으면) 새로 연다. 같은 CLI session이
// 이미 열려 있으면 둘째 process를 띄우지 않는다.
test("a member's tab opens in its project resuming its CLI session, fresh when it has none, and never twice", async () => {
  const kit = setup([], true, { codex: "codex --full-auto" });
  assert.ok(
    (
      await kit.opener.member({
        project: PROJECT,
        harness: "claude",
        cli_session: "cli-1",
      })
    ).ok,
  );
  assert.ok(
    (
      await kit.opener.member({
        project: PROJECT,
        harness: "codex",
        cli_session: null,
      })
    ).ok,
  );
  assert.deepEqual(kit.calls, [
    { project: PROJECT, command: "claude --gui --resume cli-1" },
    { project: PROJECT, command: "codex --full-auto --gui" },
  ]);
  assert.deepEqual(kit.holds, []);

  const busy = setup([{ harness: "claude", cli_session: "cli-1" }]);
  const twice = await busy.opener.member({
    project: PROJECT,
    harness: "claude",
    cli_session: "cli-1",
  });
  assert.ok(!twice.ok && twice.error.code === "conflict");
  assert.deepEqual(busy.calls, []);
});

// core가 터미널에 치는 줄에는 shell이 다르게 읽을 글자가 들어가지 않는다(ledger의 CLI session id도 받은 글이다).
test("a member's CLI session id that is not plain id characters is never typed into a terminal", async () => {
  const kit = setup([]);
  for (const cli of ["cli-1; rm -rf ~", "$(id)", "a b", "x".repeat(201)]) {
    const opened = await kit.opener.member({
      project: PROJECT,
      harness: "claude",
      cli_session: cli,
    });
    assert.ok(!opened.ok && opened.error.code === "invalid_input", cli);
  }
  assert.deepEqual(kit.calls, []);
});

// workflow_origin이 있으면 PTY는 실행 project에 열되 탭 배치는 원 workflow의 project·desk·group으로 보낸다.
test("a member with workflow_origin keeps PTY in exec project and targets the workflow workspace, desk, and group for the tab", async () => {
  const kit = setup([]);
  const origin: WorkflowOrigin = {
    project: WORKFLOW_PROJECT as WorkflowOrigin["project"],
    workflow: "release",
    instance: INSTANCE as WorkflowOrigin["instance"],
    step: "review",
  };
  const opened = await kit.opener.member({
    project: PROJECT,
    harness: "claude",
    cli_session: null,
    workflow_origin: origin,
  });
  assert.ok(opened.ok);
  assert.deepEqual(kit.calls, [
    {
      project: PROJECT,
      command: "claude --gui",
      tab: {
        workspace: WORKFLOW_PROJECT,
        desk: { workflow: "release" },
        group: `${INSTANCE}:review`,
      },
    },
  ]);
});
