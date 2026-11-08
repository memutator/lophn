import assert from "node:assert/strict";
import { test } from "node:test";
import { bundleLocatorOf } from "./routes.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const HASH = "a".repeat(64);

// preview 대상의 화면 file은 그 앱의 지금 preview nonce일 때만 나온다. 멈춘 preview의 옛 nonce나
// 다른 앱의 nonce로 남의 bundle 사본을 읽으면 안 된다.
test("preview 대상은 그 앱의 지금 nonce일 때만 bundle 사본을 찾는다", () => {
  const locator = bundleLocatorOf(
    "/data",
    { get: () => undefined, all: () => [] } as never,
    {
      bundleHashOf: (app, nonce) =>
        app === APP && nonce === "now" ? HASH : null,
    },
  );
  const dir = (app: string, process_nonce: string) =>
    locator.dir({ mode: "preview", app, process_nonce } as never);
  const found = dir(APP, "now");
  assert.ok(found.ok);
  assert.ok(found.value.includes(HASH));
  assert.deepStrictEqual(dir(APP, "old").ok, false);
  assert.deepStrictEqual(dir(OTHER_APP, "now").ok, false);
});
