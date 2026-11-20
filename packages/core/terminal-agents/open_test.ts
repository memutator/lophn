import assert from "node:assert/strict";
import { test } from "node:test";
import { ok, type Result } from "../../base/mod.ts";
import {
  codingSessionsList,
  codingSessionsOpen,
} from "../../protocol/coding-agent/relay.ts";
import { HOME_TERMINAL_PROJECT } from "../../protocol/coding-agent/terminals.ts";
import { type CodingOpenDeps, createCodingOpen } from "./open.ts";

const PROJECT = `prj_${"0".repeat(26)}`;
const LEDGER = `ses_${"1".repeat(26)}`;
const TERMINAL = `trm_${"2".repeat(26)}`;

function setup(
  listed: { harness: string; cli_session: string | null }[],
  guiOn = true,
) {
  const calls: unknown[] = [];
  const holds: string[] = [];
  const deps: CodingOpenDeps = {
    guiOn: () => guiOn,
    open(project, command) {
      calls.push({ project, command });
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
    { project: HOME_TERMINAL_PROJECT, command: "claude gui" },
  ]);
});
