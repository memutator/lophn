import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createHostQueue } from "../../../host-queue/mod.ts";
import type { AgentSessionRow } from "../../../lophn-agent/session/model.ts";
import { createTabHandlers } from "./host-queue.ts";

// preview 탭은 그 앱 workspace의 session과 사람만 열고, 주인만 닫는다. 깨지면 다른 앱·project의 agent가 남의 앱 화면을
// 사람 화면에 띄우거나 남의 탭을 닫는다.
const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const APP = id("app", 1);
const OTHER_APP = id("app", 2);
const rows: Record<string, Partial<AgentSessionRow>> = {
  [id("ses", 1)]: { workspace_kind: "app", workspace_id: APP },
  [id("ses", 2)]: { workspace_kind: "app", workspace_id: OTHER_APP },
  [id("ses", 3)]: { workspace_kind: "project", workspace_id: id("prj", 1) },
  [id("ses", 4)]: { workspace_kind: null, workspace_id: null },
};
const agent = (n: number) =>
  ({ actor: "agent", conditions: { session: id("ses", n) } }) as never;
const person = {
  actor: "user",
  conditions: {},
} as unknown as AuthenticatedContext;

function setup(running: boolean) {
  const clock = manualClock(1_700_000_000_000);
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const handlers = createTabHandlers({
    queue,
    sessionRow: (session) => rows[session] as AgentSessionRow | undefined,
    app: (app) => Promise.resolve(ok(app === APP ? {} : null)),
    preview: () => Promise.resolve(ok(running ? {} : null)),
    deviceNames: () => [],
    harnessHold: { open: () => ok({ harness: "x", external_session: "y" }) },
  });
  return { queue, ...handlers };
}
const target = { target: { preview: { app: APP } } };
const code = (reply: { ok: boolean }) =>
  reply.ok
    ? "ok"
    : (reply as unknown as { error: { code: string } }).error.code;

test("preview 탭은 그 앱 workspace의 session과 사람만 연다", async () => {
  const { queue, open } = setup(true);
  for (const n of [2, 3, 4]) {
    assert.equal(code(await open(agent(n), target)), "not_found");
  }
  assert.equal(queue.take([{ kind: "app", id: APP as never }]), null);
  assert.equal(code(await open(agent(1), target)), "ok");
  assert.equal(code(await open(person, target)), "ok");
  // 사람 token은 session 탭을 열지 못한다.
  const session = { target: { session: id("ses", 1) } };
  assert.equal(code(await open(person, session)), "invalid_input");
});

test("돌고 있는 preview가 없으면 conflict다", async () => {
  const { open } = setup(false);
  assert.equal(code(await open(person, target)), "conflict");
});

test("탭은 연 쪽만 닫고, 같은 앱의 preview 탭은 하나이며 주인은 나중에 연 쪽이다", async () => {
  const { open, close } = setup(true);
  const first = await open(agent(1), target);
  assert.ok(first.ok);
  const tab = (first.value as { tab: string }).tab;
  assert.equal(code(await close(person, { tab })), "forbidden");

  const second = await open(person, target);
  assert.ok(second.ok);
  assert.equal((second.value as { tab: string }).tab, tab);
  assert.equal(code(await close(agent(1), { tab })), "forbidden");
  assert.equal(code(await close(person, { tab })), "ok");
  assert.equal(code(await close(person, { tab })), "not_found");
});

// 남의 탭을 보거나 조작하면 다른 session의 로그인 page를 읽는다. 주인 대조가 shell 가용 판정보다 앞서야 not_found가 먼저 나간다.
test("browser 호출은 연 쪽만 하고, 남이나 사람이 연 탭은 not_found다", async () => {
  const { open, snapshot, act } = setup(true);
  const browser = { target: { browser: { url: "https://example.com" } } };
  const mine = await open(agent(1), browser);
  const theirs = await open(person, browser);
  assert.ok(mine.ok && theirs.ok);
  const agentTab = (mine.value as { tab: string }).tab;
  const personTab = (theirs.value as { tab: string }).tab;

  assert.equal(code(await snapshot(agent(2), { tab: agentTab })), "not_found");
  assert.equal(code(await snapshot(person, { tab: agentTab })), "not_found");
  assert.equal(code(await snapshot(agent(1), { tab: personTab })), "not_found");
  assert.equal(
    code(await act(agent(2), { tab: agentTab, type: "click", ref: "e1" })),
    "not_found",
  );
  // 주인은 주인 대조를 지나 shell이 붙어 있는지로 간다.
  assert.equal(
    code(await snapshot(agent(1), { tab: agentTab })),
    "unavailable",
  );
  assert.equal(code(await snapshot(person, { tab: personTab })), "unavailable");
});
