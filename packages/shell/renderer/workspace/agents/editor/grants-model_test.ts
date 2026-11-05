import assert from "node:assert/strict";
import { test } from "node:test";

import type { GrantApp } from "../source.ts";
import { appsFor } from "./grants-model.ts";

test("agent가 일하는 앱의 비공개 tool만 붙일 수 있고 public tool은 어느 앱 것이든 붙일 수 있다", () => {
  const tool = (name: string, isPublic: boolean) => ({
    tool: name,
    detail: "",
    effect: "read" as const,
    public: isPublic,
  });
  const app = (id: string, tools: GrantApp["tools"]) =>
    ({ app: id, name: id, tools }) as GrantApp;
  const apps = [
    app("app_mine", [tool("open1", true), tool("secret1", false)]),
    app("app_other", [tool("open2", true), tool("secret2", false)]),
    app("app_closed", [tool("secret3", false)]),
  ];
  const seen = (workspace: string | null) =>
    appsFor(apps, workspace).map((one) => [
      one.app,
      one.tools.map((a) => a.tool),
    ]);

  assert.deepStrictEqual(seen("app_mine"), [
    ["app_mine", ["open1", "secret1"]],
    ["app_other", ["open2"]],
  ]);
  assert.deepStrictEqual(seen(null), [
    ["app_mine", ["open1"]],
    ["app_other", ["open2"]],
  ]);
});
