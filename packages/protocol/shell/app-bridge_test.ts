import { assert, assertEquals } from "@std/assert";
import {
  APP_BRIDGE_IPC,
  appCallSchema,
  appOpenExternalSchema,
  appViewErrorSchema,
  EXTERNAL_URL_MAX_CHARS,
  externalLinkRecord,
  externalUrlSchema,
  type LophnApp,
} from "./app-bridge.ts";
import {
  EXTERNAL_URL_MAX_CHARS as PORTABLE_LIMIT,
  type LophnApp as PortableLophnApp,
} from "./app-bridge-types.ts";

Deno.test(
  "shell/app-frame#R15: lophnApp는 call과 openExternal만 공개하고 IPC는 app:call·app:open-external·내부 app:view-error다",
  () => {
    assertEquals(Object.keys(APP_BRIDGE_IPC), [
      "app:call",
      "app:open-external",
      "app:view-error",
    ]);
    const bridge: LophnApp = {
      call: () => Promise.reject(new Error("x")),
      openExternal: () => Promise.reject(new Error("x")),
    };
    assertEquals(Object.keys(bridge), ["call", "openExternal"]);
    const portable: PortableLophnApp = bridge;
    assertEquals(Object.keys(portable), ["call", "openExternal"]);
    assertEquals(PORTABLE_LIMIT, EXTERNAL_URL_MAX_CHARS);
    assert(
      appCallSchema.safeParse({ command: "usage.list", input: {} }).success,
    );
    assert(
      appViewErrorSchema.safeParse({
        observation: "render_error",
        name: "Error",
        message: null,
      }).success,
    );
  },
);

Deno.test(
  "shell/app-frame#R13: call 입력은 모르는 field와 빈 command를 거절한다",
  () => {
    assert(
      !appCallSchema.safeParse({
        command: "usage.list",
        input: {},
        token: "secret",
      }).success,
    );
    assert(!appCallSchema.safeParse({ command: "", input: null }).success);
    assert(!appCallSchema.safeParse({ command: " * ", input: null }).success);
    assert(
      !appViewErrorSchema.safeParse({
        observation: "error",
        name: "Error",
        message: null,
        app: "app_01arz3ndektsv4rrffq69g5fav",
      }).success,
    );
  },
);

Deno.test(
  "shell/app-frame#R5, shell/app-frame#R6: 외부 링크는 HTTP·HTTPS, userinfo 없음, 8192자 이하이고 기록은 origin·path만 남긴다",
  () => {
    assert(externalUrlSchema.safeParse("https://example.com/a").success);
    assert(externalUrlSchema.safeParse("http://example.com/a").success);
    assert(!externalUrlSchema.safeParse("ftp://example.com/a").success);
    assert(
      !externalUrlSchema.safeParse("https://user:pass@example.com/a").success,
    );
    assert(
      !externalUrlSchema.safeParse(`https://example.com/${"a".repeat(8192)}`)
        .success,
    );
    const limit = `https://example.com/${
      "a".repeat(EXTERNAL_URL_MAX_CHARS - "https://example.com/".length)
    }`;
    assertEquals(limit.length, EXTERNAL_URL_MAX_CHARS);
    assert(externalUrlSchema.safeParse(limit).success);
    assertEquals(
      externalLinkRecord("https://example.com/oauth?state=secret#frag"),
      { origin: "https://example.com", path: "/oauth" },
    );
    assert(
      !appOpenExternalSchema.safeParse({
        url: "https://example.com/a",
        confirm: true,
      }).success,
    );
  },
);
