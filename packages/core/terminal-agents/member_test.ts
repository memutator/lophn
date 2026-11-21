import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom, manualClock, ok } from "../../base/mod.ts";
import type { AcpInput, AcpState, AcpUpdate } from "../../protocol/acp/mod.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import { callReply } from "../../protocol/lophn-agent/calls.ts";
import { CredentialRegistry } from "../server/identity/registry.ts";
import type { TabHandle } from "./gui.ts";
import { createGuiMembers, type HarnessMembers } from "./member.ts";

// GUI 탭의 CLI는 turn 자격을 file로 받는다. 자격은 그 turn에만 산다: turn이 끝나면 file이 지워지고 자격이 거절되며, 다음 turn은 다른
// 자격이다. 깨지면 turn 밖의 CLI(background task 등)가 그 session의 agent로 부르거나 앞 turn의 자격이 남는다.
const TERMINAL = `trm_${"0".repeat(25)}2`;
const SESSION = `ses_${"0".repeat(25)}1`;
const at = "2026-11-21T00:00:00.000Z";
const turnId = (n: number) => `trn_${String(n).padStart(26, "0")}`;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup() {
  const registry = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse(at)),
    operations: [
      { name: callReply.name, actors: callReply.actors, kind: "command" },
    ],
  });
  let turns = 0;
  const issue = (turn: string) => {
    const issued = registry.issue({
      actor: `agent:${SESSION}`,
      principal: `agent:${SESSION}`,
      scope: {
        operations: [callReply.name],
        targets: { session: SESSION, turn },
      },
      conditions: { session: SESSION, turn, process: "harness" },
    });
    assert.ok(issued.ok);
    return { turn, token: issued.value.token };
  };
  const members: HarnessMembers = {
    ensure: async () => ok(SESSION),
    bind: async () => ok(undefined),
    next: async () => null,
    start: async () => ok(issue(turnId(++turns))),
    credential: async () => ok(issue(turnId(++turns))),
    record: async () => ok(undefined),
    finish: async () => ok(undefined),
    end: (turn) => void registry.endBy("turn", turn),
    onQueued: () => () => {},
  };
  const files = new Map<string, string>();
  const gui = createGuiMembers({
    members: () => members,
    files: {
      pathOf: (ref) => `/run/credentials/${ref}`,
      write: (ref, token) => void files.set(ref, token),
      remove: (ref) => void files.delete(ref),
    },
    projectOf: () => `prj_${"0".repeat(25)}3`,
    log: () => {},
  });
  let state: AcpState = EMPTY_ACP_STATE;
  const listeners = new Set<Parameters<TabHandle["attach"]>[0]>();
  const handle = {
    id: "win_1",
    terminal: TERMINAL,
    harness: "omp",
    handoff: "restart",
    cwd: "/work",
    state: () => state,
    attach(listener) {
      listener.snapshot(state);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    input: (_input: AcpInput) => {},
    close() {},
  } satisfies TabHandle;
  const publish = async (update: AcpUpdate) => {
    state = reduceAcp(state, update);
    for (const listener of listeners) listener.update(update);
    for (let i = 0; i < 4; i += 1) await flush();
  };
  const live = async (token: string) => (await registry.authenticate(token)).ok;
  return { gui, handle, publish, files, live };
}

test("a GUI tab's turn credential lives in its file only during that turn and the next turn gets another", async () => {
  const { gui, handle, publish, files, live } = setup();
  gui.opened(handle);
  // adapter의 첫 session 갱신은 칸을 다 싣는다. 여기서 보는 것은 CLI session id뿐이다.
  await publish({
    type: "session_changed",
    session: { cli_session: "cli-1", capabilities: {} },
  } as unknown as AcpUpdate);

  const tokens: string[] = [];
  for (const turn of ["acp_turn_1", "acp_turn_2"]) {
    await publish({ type: "turn_started", turn, at });
    const token = files.get(TERMINAL);
    assert.ok(token !== undefined, "the turn has a credential file");
    assert.equal(await live(token), true);
    tokens.push(token);
    await publish({
      type: "turn_ended",
      turn,
      at,
      outcome: "completed",
      active_ms: 1,
      error: null,
      messages: [],
      seq: 1,
    });
    assert.equal(files.has(TERMINAL), false, "the file is gone after the turn");
    assert.equal(
      await live(token),
      false,
      "the credential ended with the turn",
    );
  }
  assert.notEqual(tokens[0], tokens[1]);
});
