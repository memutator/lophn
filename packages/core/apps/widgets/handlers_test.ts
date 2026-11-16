import assert from "node:assert/strict";
import { test } from "node:test";

import { manualClock, ok } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { createWidgets } from "./handlers.ts";

const ctxOf = (actor: string) => ({ actor }) as AuthenticatedContext;
const VALUE = {
  v: 1,
  rows: [{ kind: "stat", value: "21", label: "Seoul" }],
};

function setup() {
  // app_01hzzzzzzzzzzzzzzzzzzzzzza는 active이고 weather·news를 선언한다. app_01hzzzzzzzzzzzzzzzzzzzzzzb는 보관됐다.
  const status = new Map<string, "active" | "archived">([
    ["app_01hzzzzzzzzzzzzzzzzzzzzzza", "active"],
    ["app_01hzzzzzzzzzzzzzzzzzzzzzzb", "active"],
  ]);
  let declared = ["weather", "news"];
  const widgets = createWidgets({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    appStatus: (app) => status.get(app) ?? null,
    declaredWidgets: (app) =>
      ok(
        status.has(app)
          ? {
              name: app,
              widgets:
                app === "app_01hzzzzzzzzzzzzzzzzzzzzzza"
                  ? declared.map((key) => ({ key, label: key }))
                  : [{ key: "weather", label: "weather" }],
            }
          : null,
      ),
    appsWithWidgets: () =>
      ok(
        [...status]
          .filter(([, s]) => s === "active")
          .map(([app]) => ({
            app,
            name: app,
            widgets:
              app === "app_01hzzzzzzzzzzzzzzzzzzzzzza"
                ? declared.map((key) => ({ key, label: key }))
                : [{ key: "weather", label: "weather" }],
          })),
      ),
  });
  const set = async (actor: string, key: string, value: unknown) =>
    widgets.set(ctxOf(actor), { key, value });
  const list = async () => {
    const res = await widgets.list(ctxOf("user"), {});
    assert.ok(res.ok);
    return (
      res.value as { widgets: { app: string; key: string; value: unknown }[] }
    ).widgets;
  };
  return {
    set,
    list,
    archive: (app: string) => status.set(app, "archived"),
    undeclare: (key: string) => {
      declared = declared.filter((k) => k !== key);
    },
  };
}

// 앱의 data가 다른 앱이나 없어진 앱의 이름으로 폰에 가지 않는 경계다.
test("only an app sets its own declared widget and the list drops archived apps and undeclared keys", async () => {
  const w = setup();

  const user = await w.set("user", "weather", VALUE);
  assert.ok(!user.ok && user.error.code === "forbidden");
  const undeclared = await w.set(
    "app:app_01hzzzzzzzzzzzzzzzzzzzzzza",
    "other",
    VALUE,
  );
  assert.ok(!undeclared.ok && undeclared.error.code === "invalid_input");
  const unknown = await w.set(
    "app:app_01hzzzzzzzzzzzzzzzzzzzzzzz",
    "weather",
    VALUE,
  );
  assert.ok(!unknown.ok && unknown.error.code === "not_found");

  assert.ok(
    (await w.set("app:app_01hzzzzzzzzzzzzzzzzzzzzzza", "weather", VALUE)).ok,
  );
  assert.ok(
    (await w.set("app:app_01hzzzzzzzzzzzzzzzzzzzzzza", "news", VALUE)).ok,
  );
  assert.ok(
    (await w.set("app:app_01hzzzzzzzzzzzzzzzzzzzzzzb", "weather", VALUE)).ok,
  );
  const first = await w.list();
  assert.deepStrictEqual(
    first.map((line) => [line.app, line.key, line.value !== null]),
    [
      ["app_01hzzzzzzzzzzzzzzzzzzzzzza", "weather", true],
      ["app_01hzzzzzzzzzzzzzzzzzzzzzza", "news", true],
      ["app_01hzzzzzzzzzzzzzzzzzzzzzzb", "weather", true],
    ],
  );

  w.undeclare("news");
  w.archive("app_01hzzzzzzzzzzzzzzzzzzzzzzb");
  const archived = await w.set(
    "app:app_01hzzzzzzzzzzzzzzzzzzzzzzb",
    "weather",
    VALUE,
  );
  assert.ok(!archived.ok && archived.error.code === "conflict");
  assert.deepStrictEqual(
    (await w.list()).map((line) => [line.app, line.key]),
    [["app_01hzzzzzzzzzzzzzzzzzzzzzza", "weather"]],
  );
  // 선언에 다시 생겨도 지워진 값은 돌아오지 않는다.
  assert.ok(
    (await w.set("app:app_01hzzzzzzzzzzzzzzzzzzzzzza", "weather", null)).ok,
  );
  assert.strictEqual((await w.list())[0]?.value, null);
});
