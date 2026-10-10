import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../ipc/core.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { coreAppScreens } from "./app-views.tsx";

const TODO = "app_01h455vb4pex5v6nkc6gd5fdw5";
const DRAFT = "app_01h455vb4pex5v6nkc6gd5fdw6";
const BROKEN = "app_01h455vb4pex5v6nkc6gd5fdw7";

function routedCore(
  routes: Record<string, (body: Record<string, unknown>) => CoreReply>,
): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const route = routes[`${input.resource}/${input.method}`];
        return Promise.resolve(
          route
            ? route(input.body as Record<string, unknown>)
            : { ok: false, error: { code: "not_found", message: "" } },
        );
      },
    },
  };
}

Deno.test("shell/workspace#R5: 프로젝트 탭의 앱 패널 열기는 활성 앱의 blueprint 화면 선언으로 서고 판이 없거나 읽지 못한 앱은 빠진다", async () => {
  const { core, calls } = routedCore({
    "apps/list": (body) =>
      body["cursor"] === undefined
        ? {
          ok: true,
          value: {
            apps: [
              { id: TODO, name: "Todo", active_release: "rel_1" },
              { id: DRAFT, name: "Draft", active_release: null },
            ],
            next_cursor: "page-2",
          },
        }
        : {
          ok: true,
          value: {
            apps: [{ id: BROKEN, name: "Broken", active_release: "rel_2" }],
            next_cursor: null,
          },
        },
    "apps/blueprint": (body) =>
      body["app"] === TODO
        ? {
          ok: true,
          value: {
            screens: [
              { key: "todos", label: "Todos", sizes: ["full", "panel"] },
              { key: "stats", label: "Stats", sizes: ["full"] },
            ],
          },
        }
        : { ok: false, error: { code: "unavailable", message: "" } },
  });
  const read = await coreAppScreens(core)();
  assertEquals(read, {
    ok: true,
    value: [{
      app: TODO,
      name: "Todo",
      screens: [
        { key: "todos", label: "Todos", sizes: ["full", "panel"] },
        { key: "stats", label: "Stats", sizes: ["full"] },
      ],
    }],
  });
  // 보관된 앱은 목록에 묻지 않고, 판이 없는 앱의 blueprint는 읽지 않는다.
  assertEquals(
    calls.filter((call) => call.method === "list").map((call) => call.body),
    [{ status: "active" }, { status: "active", cursor: "page-2" }],
  );
  assertEquals(
    calls.filter((call) => call.method === "blueprint").map((call) =>
      (call.body as { app: string }).app
    ),
    [TODO, BROKEN],
  );
});

Deno.test("shell/workspace#R5: 앱 목록을 읽지 못하면 앱 패널 열기는 실패로 남는다", async () => {
  const { core } = routedCore({
    "apps/list": () => ({
      ok: false,
      error: { code: "unavailable", message: "" },
    }),
  });
  assertEquals(await coreAppScreens(core)(), { ok: false });
});
