import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreAppsSource } from "./core-source.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";

function sourceReplying(reply: CoreReply): {
  core: CoreSource;
  calls: CoreCall[];
} {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        return Promise.resolve(reply);
      },
    },
  };
}

Deno.test("shell/app-frame#R26: 앱 공간이 여는 화면은 그 release의 blueprint가 full 크기를 선언한 첫 화면이다", async () => {
  const { core, calls } = sourceReplying({
    ok: true,
    value: {
      release: RELEASE,
      screens: [
        { key: "side", sizes: ["panel", "card"] },
        { key: "board", sizes: ["full", "panel"] },
        { key: "later", sizes: ["full"] },
      ],
    },
  });
  assertEquals(await coreAppsSource(core).entryScreen(APP, RELEASE), {
    ok: true,
    value: "board",
  });
  assertEquals(calls, [{
    kind: "read",
    resource: "apps",
    method: "blueprint",
    body: { app: APP, release: RELEASE },
  }]);
});

Deno.test("shell/app-frame#R26: full 화면이 없거나 다른 release를 돌려주면 열 화면이 없다고 보인다", async () => {
  const none = sourceReplying({
    ok: true,
    value: { release: RELEASE, screens: [{ key: "side", sizes: ["panel"] }] },
  });
  assertEquals(await coreAppsSource(none.core).entryScreen(APP, RELEASE), {
    ok: false,
    code: "unavailable",
  });
  const other = sourceReplying({
    ok: true,
    value: {
      release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
      screens: [{ key: "board", sizes: ["full"] }],
    },
  });
  assertEquals(await coreAppsSource(other.core).entryScreen(APP, RELEASE), {
    ok: false,
    code: "unavailable",
  });
});

Deno.test("shell/app-frame#R26: blueprint를 읽지 못하면 core가 준 code로 열 수 없다고 보인다", async () => {
  const { core } = sourceReplying({
    ok: false,
    error: { code: "unavailable", message: "core is not ready" },
  });
  assertEquals(await coreAppsSource(core).entryScreen(APP, RELEASE), {
    ok: false,
    code: "unavailable",
  });
});
