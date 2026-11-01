import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { withPublicOnly } from "./app-public.ts";
import { appCommandEntries } from "./app-tool/command.ts";
import type { AppToolkit } from "./app-toolkit.ts";
import { resolveAppCall } from "./lophn/resolve.ts";

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
  const loaded = await kit.load({ agent: "lophn", place: null });
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
  const publicOnly = [
    [APP_A, ["shown"]],
    [APP_B, ["shown"]],
  ];
  assert.deepStrictEqual(await visible([]), publicOnly);
  assert.deepStrictEqual(await visible(null), publicOnly);
  // domain 이름을 읽지 못한 앱의 비공개 tool은 없다.
  assert.deepStrictEqual(
    await visible([idOf(APP_A, "items"), idOf(APP_B, "items")], [APP_A]),
    [
      [APP_A, ["shown"]],
      [APP_B, ["items.open", "shown"]],
    ],
  );
});

// `lophn <domain> <command>`는 부를 때 푼다. 할당하지 않은 앱, 뺀 command, 다른 domain의 비공개 command는 풀리지 않아 실행되지 않는다.
test("lophn resolves an app command only for an assigned app, a kept command, and a visible domain", async () => {
  const kit = withPublicOnly(
    {
      load: () =>
        Promise.resolve(
          ok({
            views: [APP_A, APP_B].map((app) => ({
              app,
              name: app,
              release: "rel_x",
              tools: [
                tool("open", false, "items"),
                tool("peek", false, "notes"),
                tool("shown", true, "notes"),
              ],
            })),
            // APP_A만 할당했고 shown은 뺐다.
            entries: [{ app: APP_A, removed_tools: ["shown"] }],
          }),
        ),
    } as unknown as AppToolkit,
    {
      callerDomains: () => Promise.resolve([idOf(APP_A, "items")]),
      toolDomain: (app, name) => Promise.resolve(idOf(app, name)),
    },
  );
  const loaded = await kit.load({ agent: "lophn", place: null });
  if (!loaded.ok) throw new Error("load failed");
  const entries = appCommandEntries(loaded.value);
  const resolves = (...args: string[]) =>
    resolveAppCall({ args }, entries)?.entry.doc.name;
  // 맡은 domain의 비공개 command. 두 앱에 같은 이름이 있어도 할당한 앱 것만 푼다.
  assert.deepStrictEqual(resolves("items", "open"), "items.open");
  assert.deepStrictEqual(
    resolveAppCall({ args: ["items", "open"] }, entries)?.entry.app,
    APP_A,
  );
  // 다른 domain의 비공개 command와 뺀 public command.
  assert.deepStrictEqual(resolves("notes", "peek"), undefined);
  assert.deepStrictEqual(resolves("notes", "shown"), undefined);
  // 할당하지 않은 앱의 command는 항목에 없다.
  assert.deepStrictEqual(
    entries.filter((entry) => entry.app === APP_B),
    [],
  );
  assert.deepStrictEqual(resolves("items", "open", "--bogus"), undefined);
});
