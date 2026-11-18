import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { EventCondition } from "../../protocol/events/mod.ts";
import type { Workspace } from "../../protocol/lophn-agent/workspaces.ts";
import {
  type MachineCandidate,
  resolveMachine,
} from "../../protocol/machine/requester.ts";
import { CORE_APP_EVENTS, createRemoteSubscriptions } from "./subscriptions.ts";

const machineId = (suffix: string) =>
  `mch_${"0".repeat(24)}${suffix}` as Id<"mch">;
const LAPTOP = machineId("a1");
const DESK = machineId("b1");
const OFFICE = machineId("c1");
const appId = (suffix: string) => `app_${"0".repeat(24)}${suffix}` as Id<"app">;
const computers: MachineCandidate[] = [
  {
    machine: machineId("00"),
    device: `dev_${"0".repeat(24)}00` as never,
    name: "studio",
    self: true,
  },
  {
    machine: LAPTOP,
    device: `dev_${"0".repeat(24)}a1` as never,
    name: "laptop",
    self: false,
  },
  {
    machine: DESK,
    device: `dev_${"0".repeat(24)}b1` as never,
    name: "desk",
    self: false,
  },
  {
    machine: OFFICE,
    device: `dev_${"0".repeat(24)}c1` as never,
    name: "office",
    self: false,
  },
  {
    machine: machineId("c2"),
    device: `dev_${"0".repeat(24)}c2` as never,
    name: "office",
    self: false,
  },
];
const PRIVATE_APP = appId("p1");
const privateWorkspace = (workspace: Workspace | null) =>
  workspace?.kind === "app" && workspace.id === PRIVATE_APP;

function setup(input: {
  jobs: { machine: Id<"mch">; workspace: Workspace | null }[];
  apps: { app: Id<"app">; machines: string[] }[];
}) {
  const watched: { machine: string; conditions: EventCondition[] }[] = [];
  const warned: Record<string, string>[] = [];
  const state = { ...input };
  const subscriptions = createRemoteSubscriptions({
    jobs: async () => ok(state.jobs),
    apps: () => state.apps,
    computers: () => computers,
    resolve: (ref) => resolveMachine(ref, computers),
    isPrivate: privateWorkspace,
    watch(subscriber, machine, conditions) {
      assert.deepStrictEqual(subscriber, CORE_APP_EVENTS);
      watched.push({ machine, conditions });
      return ok({});
    },
    warn: (_event, fields) => void warned.push(fields),
  });
  return { state, subscriptions, watched, warned };
}

// private인 workspace의 job과 앱은 다른 컴퓨터에 구독을 걸지 않는다. 걸면 private 앱의 일이 다른 컴퓨터로 알려진다.
test("core는 job과 앱 선언이 원하는 컴퓨터마다 구독자 하나를 걸고, private인 workspace의 job과 앱의 것과 풀리지 않는 이름은 걸지 않는다", async () => {
  const t = setup({
    jobs: [
      { machine: LAPTOP, workspace: null },
      { machine: LAPTOP, workspace: { kind: "project", id: "prj_a" } },
      // private 앱 workspace에서 만든 job
      { machine: DESK, workspace: { kind: "app", id: PRIVATE_APP } },
    ],
    apps: [
      { app: appId("a1"), machines: ["laptop", "studio", "nowhere", "office"] },
      // private 앱의 선언
      { app: PRIVATE_APP, machines: ["desk"] },
    ],
  });
  await t.subscriptions.refresh();
  // laptop은 job과 앱이 겹쳐도 한 번이다. studio(이 컴퓨터)와 풀지 못하는 이름, 이름이 겹친 office는 걸지 않는다.
  assert.deepStrictEqual(t.watched, [
    { machine: LAPTOP, conditions: [{ types: ["AppEventPublished"] }] },
  ]);
  assert.deepStrictEqual(
    t.warned.map((one) => `${one.machine} ${one.reason}`),
    ["studio self", "nowhere not_found", "office invalid_input"],
  );

  // 같은 것을 다시 계산해도 다시 걸지 않고(경고도 되풀이하지 않는다), 원하지 않게 되면 그 기계의 구독자를 뺀다.
  await t.subscriptions.refresh();
  assert.equal(t.watched.length, 1);
  assert.equal(t.warned.length, 3);
  t.state.jobs = [];
  t.state.apps = [];
  await t.subscriptions.refresh();
  assert.deepStrictEqual(t.watched.at(-1), { machine: LAPTOP, conditions: [] });
});
