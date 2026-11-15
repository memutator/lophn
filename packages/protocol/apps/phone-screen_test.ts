import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PHONE_CALL_INPUT_MAX_BYTES,
  type PhoneHostInfo,
  type PhoneManifest,
  parsePhoneGuestMessage,
  phoneCanRun,
} from "./phone-screen.ts";

const host: PhoneHostInfo = {
  base: 2,
  kit: "1.4.0",
  app_ui_native: "1.2.3",
  modules: ["react", "react-native", "@lophn/ui-native"],
};

function manifest(patch: {
  base?: number;
  kit?: string;
  app?: string;
  modules?: string[];
}): PhoneManifest {
  return {
    format: 1,
    entry: "phone.js",
    size: 10,
    sha256: "0".repeat(64),
    base: patch.base ?? 2,
    kit: {
      "@lophn/ui-native": patch.kit ?? "1.4.0",
      "@lophn/app-ui-native": patch.app ?? "1.2.3",
    },
    modules: patch.modules ?? ["react"],
  };
}

test("phoneCanRun은 폰보다 새 화면과 모르는 module은 phone_too_old, 옛 major는 screen_too_old로 거절하고 같은 major의 옛 판은 받는다", () => {
  const cases: [string, PhoneManifest, string][] = [
    ["same", manifest({}), "ok"],
    ["older minor of the same major", manifest({ kit: "1.0.9" }), "ok"],
    ["older base", manifest({ base: 1 }), "ok"],
    ["newer base", manifest({ base: 3 }), "phone_too_old"],
    ["newer kit minor", manifest({ kit: "1.10.0" }), "phone_too_old"],
    ["newer kit major", manifest({ kit: "2.0.0" }), "phone_too_old"],
    ["newer app-ui-native patch", manifest({ app: "1.2.4" }), "phone_too_old"],
    [
      "module the phone does not know",
      manifest({ modules: ["react", "expo-secure-store"] }),
      "phone_too_old",
    ],
    ["older kit major", manifest({ kit: "0.9.0" }), "screen_too_old"],
    ["older app-ui-native major", manifest({ app: "0.1.0" }), "screen_too_old"],
    [
      "older major and newer base: phone_too_old wins",
      manifest({ base: 3, kit: "0.9.0" }),
      "phone_too_old",
    ],
    [
      "older major on one kit, newer on the other: phone_too_old wins",
      manifest({ kit: "0.9.0", app: "1.3.0" }),
      "phone_too_old",
    ],
  ];
  for (const [name, input, want] of cases) {
    const got = phoneCanRun(input, host);
    assert.equal(got.ok ? "ok" : got.reason, want, name);
  }
});

test("guest 메시지는 64 KiB를 넘는 call input과 모르는 칸이 있는 메시지를 거절한다", () => {
  const call = (input: unknown) =>
    parsePhoneGuestMessage(
      JSON.stringify({ type: "call", id: 1, operation: "items.list", input }),
    );
  assert.equal(call({ q: "x" }).ok, true);
  const edge = PHONE_CALL_INPUT_MAX_BYTES - 2; // the two quotes
  assert.equal(call("x".repeat(edge)).ok, true);
  assert.equal(call("x".repeat(edge + 1)).ok, false);
  // multi-byte text counts bytes, not characters
  assert.equal(call("가".repeat(Math.ceil(edge / 3) + 1)).ok, false);

  assert.equal(parsePhoneGuestMessage('{"type":"ready","extra":1}').ok, false);
  assert.equal(
    parsePhoneGuestMessage(
      '{"type":"call","id":1,"operation":"a","input":null,"view":"v"}',
    ).ok,
    false,
  );
  assert.equal(parsePhoneGuestMessage('{"type":"ready"}').ok, true);
});
