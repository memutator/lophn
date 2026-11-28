import assert from "node:assert/strict";
import { test } from "node:test";

import type { GrantApp } from "../source.ts";
import {
  appsFor,
  isAsk,
  isRemoved,
  withToolAsk,
  withToolRemoved,
} from "./grants-model.ts";

test("다른 컴퓨터의 앱은 public tool만 붙일 수 있다", () => {
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
  assert.deepStrictEqual(
    appsFor(apps).map((one) => [one.app, one.tools.map((a) => a.tool)]),
    [
      ["app_mine", ["open1"]],
      ["app_other", ["open2"]],
    ],
  );
});

test("ask_tools와 removed_tools는 서로 겹치지 않는다", () => {
  const base = {
    app: "app_mine",
    machine: "mch_other",
    name: "Mine",
    removed_tools: ["delete_expense"],
  };
  const asked = withToolAsk(base, "delete_expense", true);
  assert.equal(isAsk(asked, "delete_expense"), true);
  assert.equal(isRemoved(asked, "delete_expense"), false);

  const removedAgain = withToolRemoved(asked, "delete_expense", true);
  assert.equal(isRemoved(removedAgain, "delete_expense"), true);
  assert.equal(isAsk(removedAgain, "delete_expense"), false);
  assert.equal(removedAgain.ask_tools, undefined);
});
