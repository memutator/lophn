import { assert, assertEquals } from "@std/assert";
import { createLogBuffer } from "../../packages/apps/runtime/observations/log-buffer.ts";
import { createKnownSecretRegistry } from "../../packages/platform/redaction/mod.ts";
import { lineRedactor } from "./log-redact.ts";

const SECRET = "known-secret-value-4f9a2c7d";

Deno.test("apps/runtime#R26: 실제 자식이 찍은 알려진 secret과 credential 모양은 log buffer에 남지 않는다", async () => {
  const registry = createKnownSecretRegistry();
  registry.register([SECRET]);
  const log = createLogBuffer({
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    redact: lineRedactor(registry),
    now: () => Date.now(),
  });
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `console.log("start ${SECRET} end");` +
      `console.log("auth ghp_abcdefghijklmnopqrstuvwxyz0123456789");` +
      `console.log("x".repeat(500));`,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const reader = child.stdout.getReader();
  const attached = log.attach({
    async read(target) {
      const next = await reader.read();
      if (next.done) return null;
      target.set(next.value.subarray(0, target.length));
      return Math.min(target.length, next.value.length);
    },
  });
  await child.status;
  await attached;
  const lines = log.read({ limit: 200 }).lines;
  assertEquals(lines.length, 3);
  assert(!lines.join("\n").includes(SECRET));
  assert(!lines.join("\n").includes("abcdefghijklmnopqrstuvwxyz"));
  assert(lines[0].includes("start") && lines[0].includes("end"));
  assertEquals(lines[2].length, 300);
});
