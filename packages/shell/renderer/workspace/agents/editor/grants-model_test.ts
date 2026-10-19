import { assertEquals } from "@std/assert";

import type { AgentGrantEntry } from "../../../../../protocol/approvals/grants.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { DomainView } from "../../source.ts";
import type { GrantApp } from "../source.ts";
import {
  agentEntryOf,
  appsFor,
  callPick,
  domainNamesOf,
  KEPT,
  withCallPick,
} from "./grants-model.ts";

const agent = { role: "coding_agent", app: "app_a" } as CallAgent;

Deno.test("agent 부르기를 끄면 줄이 excluded로 남고, 줄 없는 agent는 켜진 것으로 읽힌다", () => {
  assertEquals(callPick(agentEntryOf([], agent)), KEPT);

  const off = withCallPick([], agent, { removed: true });
  assertEquals(off, [{ kind: "agent", agent, setting: "excluded" }]);
  assertEquals(callPick(agentEntryOf(off, agent)), { removed: true });

  const on = withCallPick(off, agent, { removed: false });
  assertEquals(on as AgentGrantEntry[], []);
});

Deno.test("고른 domain의 비공개 tool만 붙일 수 있고 public tool은 어느 domain 것이든 붙일 수 있다", () => {
  const tool = (domain: string, name: string, isPublic: boolean) => ({
    tool: name,
    detail: "",
    effect: "read" as const,
    addedIn: null,
    public: isPublic,
    domain,
  });
  const app = (id: string, tools: GrantApp["tools"]) =>
    ({ app: id, name: id, release: null, tools }) as GrantApp;
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

  assertEquals(seen(["d1"]), [
    ["app_mine", ["open1", "secret1", "open2"]],
    ["app_other", ["open3"]],
  ]);
  assertEquals(seen([]), [["app_mine", ["open1", "open2"]], [
    "app_other",
    ["open3"],
  ]]);
});

Deno.test("고른 domain이 없으면 그릇의 모든 domain을 고른 것으로 보고, 그릇에 없는 id는 센 것에서 뺀다", () => {
  const view = (id: string, name: string): DomainView => ({
    id,
    name,
    title: name,
    purpose: "",
    status: "active",
  });
  const container = [view("dom_1", "d1"), view("dom_2", "d2")];
  assertEquals(domainNamesOf([], container), ["d1", "d2"]);
  assertEquals(domainNamesOf(["dom_2", "dom_gone"], container), ["d2"]);
});
