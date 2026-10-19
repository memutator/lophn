import { assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import { withPublicOnly } from "./app-public.ts";
import type { AppApiToolkit } from "./app-toolkit.ts";
import type { CoreCall } from "../run-loop/core-call.ts";

const ULID = "01arz3ndektsv4rrffq69g5fav";
const APP_A = `app_${ULID}`;
const APP_B = `app_${ULID.slice(0, -1)}w`;
const PRJ_A = `prj_${ULID}`;
const PRJ_B = `prj_${ULID.slice(0, -1)}w`;

const tool = (name: string, isPublic: boolean) => ({
  name,
  title: name,
  description: name,
  inputSchema: null,
  effect: "read" as const,
  public: isPublic,
});
const views = [APP_A, APP_B].map((app) => ({
  app,
  name: app,
  release: "rel_x",
  tools: [tool("open", false), tool("shown", true)],
}));
const entries = [APP_A, APP_B].map((app) => ({
  kind: "app" as const,
  app,
  apis: [],
}));
const inner = {
  load: () => Promise.resolve(ok({ views, entries })),
} as unknown as AppApiToolkit;

// 앱 A는 project A, 앱 B는 project B. unreadable 앱은 읽지 못한다.
const machine: CoreCall = () => Promise.resolve(err(NOPE));
const NOPE = { code: "not_found", message: "no" } as const;
function appProject(unreadable: string[]) {
  return (app: string) =>
    Promise.resolve(
      unreadable.includes(app) ? null : app === APP_A ? PRJ_A : PRJ_B,
    );
}

async function visible(agent: AgentRef, unreadable: string[] = []) {
  const kit = withPublicOnly(inner, {
    machine,
    appProject: appProject(unreadable),
  });
  const loaded = await kit.load(agent);
  if (!loaded.ok) throw new Error("load failed");
  return loaded.value.views.map((view) => [
    view.app,
    view.tools.map((one) => one.name).sort(),
  ]);
}

Deno.test("another project's private tools are hidden, the same project's are not", async () => {
  const pm = { role: "project_manager", project: PRJ_A } as AgentRef;
  assertEquals(await visible(pm), [
    [APP_A, ["open", "shown"]],
    [APP_B, ["shown"]],
  ]);
  // place가 없는 lophn은 모든 앱을 다른 project로 본다.
  assertEquals(await visible({ role: "lophn" }), [
    [APP_A, ["shown"]],
    [APP_B, ["shown"]],
  ]);
  // 앱의 project를 읽지 못하면 막는 쪽으로 실패한다.
  assertEquals(await visible(pm, [APP_A]), [
    [APP_A, ["shown"]],
    [APP_B, ["shown"]],
  ]);
});
