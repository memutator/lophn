import { assertEquals } from "@std/assert";
import { checkStagedLock } from "./lock-check.ts";

const source = {
  specifiers: { "npm:zod@4.6.5": "4.6.5", "jsr:@std/toml@1.0.2": "1.0.2" },
  jsr: { "@std/toml@1.0.2": { integrity: "aaa" } },
  npm: {
    "zod@4.6.5": { integrity: "sha512-zod" },
    "react@19.3.0": { integrity: "sha512-react" },
  },
};

Deno.test("platform/security#R5: 묶음 lock은 저장소 lock의 일부일 때만 통과한다", () => {
  const staged = {
    specifiers: { "npm:zod@4.6.5": "4.6.5" },
    jsr: {},
    npm: { "zod@4.6.5": { integrity: "sha512-zod" } },
  };
  assertEquals(checkStagedLock(source, staged), { ok: true });
});

Deno.test("platform/security#R5: 새 의존성·바뀐 integrity·바뀐 version은 막는다", () => {
  const result = checkStagedLock(source, {
    specifiers: { "npm:zod@4.6.5": "4.6.6" },
    jsr: { "@std/new@1.0.0": { integrity: "x" } },
    npm: { "zod@4.6.5": { integrity: "sha512-changed" } },
  });
  assertEquals(result, {
    ok: false,
    changed: [
      "jsr:@std/new@1.0.0",
      "npm:zod@4.6.5",
      "specifiers:npm:zod@4.6.5",
    ],
  });
});
