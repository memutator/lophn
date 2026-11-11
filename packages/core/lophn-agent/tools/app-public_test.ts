import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { withPublicOnly } from "./app-public.ts";
import { appCommandEntries, appCommandTool } from "./app-tool/command.ts";
import type { AppToolkit } from "./app-toolkit.ts";
import { resolveAppCall } from "./lophn/resolve.ts";
import { parseCommandLine } from "../../../cli/parser.ts";
import { toolForWireName } from "./wire.ts";

const ULID = "01arz3ndektsv4rrffq69g5fav";
const APP_A = `app_${ULID}`;
const APP_B = `app_${ULID.slice(0, -1)}w`;
const SLUG = { [APP_A]: "alpha", [APP_B]: "beta" } as Record<string, string>;

// 앱마다 비공개 tool 하나와 공개 tool 하나.
const tool = (name: string, isPublic: boolean) => ({
  name,
  description: name,
  inputSchema: null,
  effect: "read" as const,
  public: isPublic,
});
const view = (app: string, tools: ReturnType<typeof tool>[]) => ({
  app,
  slug: SLUG[app],
  name: app,
  release: "rel_x",
  tools,
});
const inner = {
  load: () =>
    Promise.resolve(
      ok({
        views: [APP_A, APP_B].map((app) =>
          view(app, [tool("open", false), tool("shown", true)]),
        ),
        entries: [APP_A, APP_B].map((app) => ({ app, removed_tools: [] })),
      }),
    ),
} as unknown as AppToolkit;

async function names(
  workspace: { kind: "app" | "project"; id: string } | null,
) {
  const loaded = await withPublicOnly(inner).load({
    agent: "lophn_home",
    workspace,
  });
  if (!loaded.ok) throw new Error("load failed");
  return loaded.value.views.map((one) => [
    one.app,
    one.tools.map((t) => t.name).sort(),
  ]);
}

test("an agent sees the private tools of its own app workspace only, public tools of any", async () => {
  assert.deepStrictEqual(await names({ kind: "app", id: APP_A }), [
    [APP_A, ["open", "shown"]],
    [APP_B, ["shown"]],
  ]);
  const publicOnly = [
    [APP_A, ["shown"]],
    [APP_B, ["shown"]],
  ];
  assert.deepStrictEqual(await names(null), publicOnly);
  assert.deepStrictEqual(
    await names({ kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" }),
    publicOnly,
  );
});

// `lophn <slug> <command>`는 부를 때 푼다. 할당하지 않은 앱, 뺀 command, 다른 앱의 비공개 command는 풀리지 않아 실행되지 않는다.
test("lophn resolves an app command only for an assigned app, a kept command, and a visible private command", async () => {
  const kit = withPublicOnly({
    load: () =>
      Promise.resolve(
        ok({
          views: [APP_A, APP_B].map((app) =>
            view(app, [
              tool("open", false),
              tool("peek", false),
              tool("shown", true),
            ]),
          ),
          // APP_A만 할당했고 shown은 뺐다.
          entries: [{ app: APP_A, removed_tools: ["shown"] }],
        }),
      ),
  } as unknown as AppToolkit);
  const loaded = await kit.load({
    agent: "lophn_home",
    workspace: { kind: "app", id: APP_A },
  });
  if (!loaded.ok) throw new Error("load failed");
  const entries = appCommandEntries(loaded.value);
  const resolves = (...args: string[]) =>
    resolveAppCall({ args }, entries)?.entry.doc.name;
  // 그 앱 workspace의 비공개 command. 할당하지 않은 앱 것은 항목에 없다.
  assert.deepStrictEqual(resolves("alpha", "open"), "alpha.open");
  assert.deepStrictEqual(resolves("beta", "open"), undefined);
  assert.deepStrictEqual(
    resolveAppCall({ args: ["alpha", "open"] }, entries)?.entry.app,
    APP_A,
  );
  assert.deepStrictEqual(resolves("alpha", "shown"), undefined);
  assert.deepStrictEqual(resolves("alpha", "open", "--bogus"), undefined);
});

test("a resolved app command is found by the executor's wire name lookup", () => {
  const entries = appCommandEntries({
    views: [view(APP_A, [tool("open", false)])],
    entries: [{ app: APP_A, removed_tools: [] }],
  });
  const hit = resolveAppCall({ args: ["alpha", "open"] }, entries);
  assert.ok(hit !== undefined);
  assert.deepStrictEqual(
    toolForWireName([appCommandTool(hit.entry)], hit.name)?.name,
    "alpha.open",
  );
});

test("wrong CLI spelling stays unexecuted and corrections only name commands the agent can call", () => {
  const entries = appCommandEntries({
    views: [view(APP_A, [tool("add_event", false), tool("quota.list", false)])],
    entries: [{ app: APP_A, removed_tools: ["quota.list"] }],
  });
  const docs = entries.map((entry) => entry.doc);
  assert.equal(
    resolveAppCall({ args: ["alpha", "add_event", "--help"] }, entries),
    undefined,
  );
  const spelling = parseCommandLine(["alpha", "add_event", "--help"], docs);
  assert.ok(!spelling.ok);
  assert.equal(spelling.error.code, "invalid_input");
  assert.ok(spelling.error.message.includes("alpha add-event"));
  for (const args of [
    ["alpha", "quota.list"],
    ["beta", "add_event"],
  ]) {
    assert.equal(resolveAppCall({ args }, entries), undefined);
    const unavailable = parseCommandLine(args, docs);
    assert.ok(!unavailable.ok);
    assert.ok(!unavailable.error.message.includes("alpha quota list"));
    assert.ok(!unavailable.error.message.includes("beta add-event"));
  }
  assert.equal(
    resolveAppCall({ args: ["alpha", "add-event"] }, entries)?.entry.command
      .name,
    "add_event",
  );
});
