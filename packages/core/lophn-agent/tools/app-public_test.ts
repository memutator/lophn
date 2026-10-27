import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import { withPublicOnly } from "./app-public.ts";
import type { AppToolkit } from "./app-toolkit.ts";

const ULID = "01arz3ndektsv4rrffq69g5fav";
const APP_A = `app_${ULID}`;
const APP_B = `app_${ULID.slice(0, -1)}w`;

// 앱마다 domain 둘(items, notes)의 비공개 tool 하나씩과 공개 tool 하나.
const tool = (name: string, isPublic: boolean, domain: string) => ({
  name,
  title: name,
  description: name,
  inputSchema: null,
  effect: "read" as const,
  public: isPublic,
  domain,
});
const views = [APP_A, APP_B].map((app) => ({
  app,
  name: app,
  release: "rel_x",
  tools: [
    tool("items.open", false, "items"),
    tool("notes.open", false, "notes"),
    tool("shown", true, "notes"),
  ],
}));
const entries = [APP_A, APP_B].map((app) => ({
  app,
  removed_tools: [],
}));
const inner = {
  load: () => Promise.resolve(ok({ views, entries })),
} as unknown as AppToolkit;

// domain id는 `<앱>/<이름>`. unreadable 앱은 domain을 읽지 못한다.
const idOf = (app: string, name: string) => `${app}/${name}`;

async function visible(mine: string[] | null, unreadable: string[] = []) {
  const kit = withPublicOnly(inner, {
    callerDomains: () => Promise.resolve(mine),
    toolDomain: (app, name) =>
      Promise.resolve(unreadable.includes(app) ? null : idOf(app, name)),
  });
  const loaded = await kit.load({ role: "lophn" } as AgentRef);
  if (!loaded.ok) throw new Error("load failed");
  return loaded.value.views.map((view) => [
    view.app,
    view.tools.map((one) => one.name).sort(),
  ]);
}

test("an agent sees the private tools of its own domains only, public tools of any", async () => {
  // domain A/items만 맡은 agent: 그 domain의 비공개 tool이 있고, 같은 앱의 다른 domain과 다른 앱은 공개만.
  assert.deepStrictEqual(await visible([idOf(APP_A, "items")]), [
    [APP_A, ["items.open", "shown"]],
    [APP_B, ["shown"]],
  ]);
  // 집합이 없는 lophn(과 읽지 못한 agent)은 공개만 본다.
  const publicOnly = [[APP_A, ["shown"]], [APP_B, ["shown"]]];
  assert.deepStrictEqual(await visible([]), publicOnly);
  assert.deepStrictEqual(await visible(null), publicOnly);
  // domain 이름을 읽지 못한 앱의 비공개 tool은 없다.
  assert.deepStrictEqual(
    await visible([idOf(APP_A, "items"), idOf(APP_B, "items")], [APP_A]),
    [[APP_A, ["shown"]], [APP_B, ["items.open", "shown"]]],
  );
});
