import assert from "node:assert/strict";
import { test } from "node:test";

import type { DomainView } from "../../source.ts";
import type { GrantApp } from "../source.ts";
import { appsFor, domainNamesOf } from "./grants-model.ts";

test("고른 domain의 비공개 tool만 붙일 수 있고 public tool은 어느 domain 것이든 붙일 수 있다", () => {
  const tool = (domain: string, name: string, isPublic: boolean) => ({
    tool: name,
    detail: "",
    effect: "read" as const,
    public: isPublic,
    domain,
  });
  const app = (id: string, tools: GrantApp["tools"]) =>
    ({ app: id, name: id, tools }) as GrantApp;
  const apps = [
    app("app_mine", [
      tool("d1", "open1", true),
      tool("d1", "secret1", false),
      tool("d2", "open2", true),
      tool("d2", "secret2", false),
    ]),
    app("app_other", [tool("d3", "open3", true), tool("d3", "secret3", false)]),
    app("app_closed", [tool("d4", "secret4", false)]),
  ];
  const seen = (domains: readonly string[]) =>
    appsFor(apps, domains).map((
      one,
    ) => [one.app, one.tools.map((a) => a.tool)]);

  assert.deepStrictEqual(seen(["d1"]), [
    ["app_mine", ["open1", "secret1", "open2"]],
    ["app_other", ["open3"]],
  ]);
  assert.deepStrictEqual(seen([]), [["app_mine", ["open1", "open2"]], [
    "app_other",
    ["open3"],
  ]]);
});

test("고른 domain이 없으면 그릇의 모든 domain을 고른 것으로 보고, 그릇에 없는 id는 센 것에서 뺀다", () => {
  const view = (id: string, name: string): DomainView => ({
    id,
    name,
    title: name,
    purpose: "",
    status: "active",
  });
  const container = [view("dom_1", "d1"), view("dom_2", "d2")];
  assert.deepStrictEqual(domainNamesOf([], container), ["d1", "d2"]);
  assert.deepStrictEqual(domainNamesOf(["dom_2", "dom_gone"], container), [
    "d2",
  ]);
});
