import { assertEquals } from "@std/assert";

import type { AgentGrantEntry } from "../../../../../protocol/approvals/grants.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { GrantApp } from "../source.ts";
import {
  agentEntryOf,
  appsFor,
  callPick,
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

Deno.test("다른 앱의 tool은 public만 붙일 수 있고, agent가 놓인 앱의 tool은 모두 보인다", () => {
  const api = (name: string, isPublic: boolean) => ({
    api: name,
    detail: "",
    effect: "read" as const,
    addedIn: null,
    public: isPublic,
  });
  const app = (id: string, apis: GrantApp["apis"]) =>
    ({ app: id, name: id, release: null, apis }) as GrantApp;
  const apps = [
    app("app_mine", [api("open", true), api("secret", false)]),
    app("app_other", [api("open", true), api("secret", false)]),
    app("app_closed", [api("secret", false)]),
  ];

  const seen = (place: string | null) =>
    appsFor(apps, place).map((one) => [one.app, one.apis.map((a) => a.api)]);
  assertEquals(seen("app_mine"), [
    ["app_mine", ["open", "secret"]],
    ["app_other", ["open"]],
  ]);
  // project place와 lophn에게는 모든 앱의 public tool만 보인다.
  const publicOnly = [["app_mine", ["open"]], ["app_other", ["open"]]];
  assertEquals(seen("prj_a"), publicOnly);
  assertEquals(seen(null), publicOnly);
});
