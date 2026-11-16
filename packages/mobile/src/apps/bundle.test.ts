import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { PhoneHostInfo } from "../../../protocol/apps/phone-screen.ts";
import type { PhoneScreen } from "../data/apps.ts";
import { type BundleFiles, prepareBundle } from "./bundle.ts";

const HOST: PhoneHostInfo = {
  base: 1,
  kit: "0.1.0",
  app_ui_native: "1.1.0",
  modules: ["react", "@lophn/ui-native"],
};

const JS = "try{globalThis.__lophnMount(function(){return null})}catch(e){globalThis.__lophnFatal(e)}";
const bytes = new TextEncoder().encode(JS);

function screenOf(manifest: Partial<PhoneScreen["manifest"]> = {}): PhoneScreen {
  return {
    app: "app_01h455vb4pex5v6nkc6gd5f001",
    app_name: "Orders",
    icon: null,
    screen: "orders",
    label: "Orders",
    release: "rel_01h455vb4pex5v6nkc6gd5f007",
    bundle_hash: "a".repeat(64),
    manifest: {
      format: 1,
      entry: "phone.js",
      size: bytes.byteLength,
      sha256: bytesToHex(sha256(bytes)),
      base: 1,
      kit: { "@lophn/ui-native": "0.1.0", "@lophn/app-ui-native": "1.1.0" },
      modules: ["react"],
      ...manifest,
    },
    running: true,
  } as PhoneScreen;
}

function harness(served: Uint8Array = bytes) {
  const stored = new Map<string, Uint8Array | string>();
  const files: BundleFiles = {
    exists: (path) => stored.has(path),
    readText: (path) => {
      const found = stored.get(path);
      return typeof found === "string" ? found : null;
    },
    write: (path, content) => void stored.set(path, content),
    remove: (path) => {
      for (const key of [...stored.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) stored.delete(key);
      }
    },
    list: () => [],
    absolute: (path) => `/files/phone-screens/${path}`,
  };
  const calls: unknown[] = [];
  const core = {
    call: async (input: unknown) => {
      calls.push(input);
      return {
        ok: true,
        value: { content_type: "text/javascript", base64: Buffer.from(served).toString("base64") },
      };
    },
  };
  const scripts = () => [...stored.keys()].filter((key) => key.endsWith("phone.js"));
  return { deps: { core, files, host: HOST }, stored, calls, scripts };
}

test("a screen bundle is kept and opened only when its bytes match the manifest's size and sha256", async () => {
  const good = harness();
  const first = await prepareBundle(good.deps, "computer", screenOf());
  assert.deepEqual(first, {
    ok: true,
    file: `/files/phone-screens/computer/${"a".repeat(64)}/orders/phone.js`,
  });
  assert.deepEqual(good.stored.get(good.scripts()[0]!), bytes);
  // Kept under its bundle hash: never taken again.
  await prepareBundle(good.deps, "computer", screenOf());
  assert.equal(good.calls.length, 1);

  const tampered = new TextEncoder().encode(JS.replace("null", "1234"));
  for (const served of [tampered, bytes.subarray(1)]) {
    const bad = harness(served);
    assert.deepEqual(await prepareBundle(bad.deps, "computer", screenOf()), {
      ok: false,
      reason: "mismatch",
    });
    assert.deepEqual(bad.scripts(), []);
  }
});

test("a screen the phone is too old for, or built for an old kit, is neither taken nor opened", async () => {
  const cases: [Partial<PhoneScreen["manifest"]>, string][] = [
    [{ kit: { "@lophn/ui-native": "0.2.0", "@lophn/app-ui-native": "1.1.0" } }, "phone_too_old"],
    [{ modules: ["react", "react-native-camera"] }, "phone_too_old"],
    [{ base: 2 }, "phone_too_old"],
    [{ kit: { "@lophn/ui-native": "0.1.0", "@lophn/app-ui-native": "0.9.0" } }, "screen_too_old"],
  ];
  for (const [manifest, reason] of cases) {
    const { deps, calls, stored } = harness();
    assert.deepEqual(await prepareBundle(deps, "computer", screenOf(manifest)), {
      ok: false,
      reason,
    });
    assert.equal(calls.length, 0);
    assert.equal(stored.size, 0);
  }
});
