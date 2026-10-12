import { assert, assertEquals } from "@std/assert";
import { runGuest } from "./adapters/quickjs-host/host.ts";
import { checkExtraction } from "./check.ts";
import { buildGuestBundle, moduleHash } from "./guest/bundle.ts";
import { BUILTIN_MODULE_HASH } from "./guest/module-hash.ts";
import { extractFormat } from "./guest.ts";
import { builtinModule, findModule } from "./modules.ts";
import { encodeUtf8 } from "./pure/utf8.ts";
import type { FormatModuleInput } from "./pure/input.ts";
import { runFormat } from "./work.ts";

const HASH = "ab".repeat(32);

function guestInput(text: string, media = "text/markdown"): FormatModuleInput {
  return {
    input_hash: HASH,
    module_hash: BUILTIN_MODULE_HASH,
    files: [{
      path: "doc.md",
      media_type: media,
      primary: true,
      content: encodeUtf8(text),
    }],
  };
}

Deno.test("documents/formats#R18: file, network, time, random, env and subprocess access fail", async () => {
  const bundle = await Deno.readTextFile(
    new URL("./guest/bundle.js", import.meta.url),
  );
  const request = JSON.stringify({
    operation: "extract",
    name: "document",
    input: guestInput("x"),
  });
  const probes = [
    "Deno.readTextFileSync('/etc/passwd')",
    "fetch('https://example.com')",
    "Date.now()",
    "Math.random()",
    "crypto.getRandomValues(new Uint8Array(1))",
    "Deno.env.get('HOME')",
    "new Deno.Command('deno')",
    "eval('1')",
    "new Function('return 1')()",
    "new WebAssembly.Module(new Uint8Array())",
  ];
  for (const probe of probes) {
    const ran = await runGuest(
      bundle,
      `(() => { ${probe}; return JSON.stringify(dispatch(${request})); })()`,
    );
    assertEquals(ran.ok, false, probe);
  }
});

Deno.test("documents/formats#R18: an infinite loop is killed at the call deadline", async () => {
  const bundle = "globalThis.dispatch = () => { while (true) {} };";
  const started = Date.now();
  const ran = await runGuest(
    bundle,
    JSON.stringify({
      operation: "extract",
      name: "document",
      input: guestInput("x"),
    }),
    { timeoutMs: 300 },
  );
  assertEquals(ran.ok, false);
  if (!ran.ok) assertEquals(ran.failure, "limit");
  assert(Date.now() - started < 5_000);
});

Deno.test("documents/formats#R18: output over the limit is rejected", async () => {
  const bundle = "globalThis.dispatch = () => 'x'.repeat(100);";
  const ran = await runGuest(
    bundle,
    JSON.stringify({
      operation: "extract",
      name: "document",
      input: guestInput("x"),
    }),
    { outputMaxBytes: 16 },
  );
  assertEquals(ran.ok, false);
  if (!ran.ok) assertEquals(ran.failure, "limit");
});

Deno.test("documents/formats#R18: the same input and module produce the same output", async () => {
  const module = await builtinModule();
  const input = guestInput("# Title\n\nBody.\n");
  const request = {
    operation: "extract" as const,
    name: "document" as const,
    module_hash: module.hash,
    bundle: module.bundle,
    input,
  };
  const first = await runFormat(request, { timeoutMs: 20_000 });
  const second = await runFormat(request, { timeoutMs: 20_000 });
  assert(first.ok && second.ok);
  assertEquals(second, first);
  assertEquals(first.output, extractFormat("document", input));
});

Deno.test("documents/formats#R19: a module that fails one fixture or emits a cycle is not usable", async () => {
  const rebuilt = await buildGuestBundle();
  const stored = await Deno.readTextFile(
    new URL("./guest/bundle.js", import.meta.url),
  );
  assertEquals(rebuilt, stored);
  assertEquals(moduleHash(stored), BUILTIN_MODULE_HASH);

  const broken = stored.replace(
    "globalThis.dispatch = dispatch;",
    "globalThis.dispatch = () => { throw new Error('fixture failed'); };",
  );
  const fixture = await runGuest(
    broken,
    JSON.stringify({
      operation: "extract",
      name: "document",
      input: guestInput("# T\n"),
    }),
  );
  assertEquals(fixture.ok, false);

  const cyclic = {
    input_hash: HASH,
    module_hash: BUILTIN_MODULE_HASH,
    status: "ready",
    title: null,
    text: "a\n",
    text_hash: "ab".repeat(32),
    sections: [
      {
        key: "a",
        title: "A",
        parent: "b",
        position: 0,
        level: 1,
        anchor: null,
        own_ranges: [{ start_line: 1, end_line: 1 }],
        subtree_range: { start_line: 1, end_line: 1 },
        characters: 1,
        body_hash: "cd".repeat(32),
      },
      {
        key: "b",
        title: "B",
        parent: "a",
        position: 1,
        level: 1,
        anchor: null,
        own_ranges: [{ start_line: 1, end_line: 1 }],
        subtree_range: { start_line: 1, end_line: 1 },
        characters: 1,
        body_hash: "cd".repeat(32),
      },
    ],
  };
  const checked = checkExtraction(cyclic);
  assertEquals(checked.ok, false);
});

Deno.test("documents/formats#R20: a missing module and a runner failure are different reasons", async () => {
  const missing = await findModule("0".repeat(64));
  assertEquals(missing, { found: false, reason: "missing" });

  const present = await findModule(BUILTIN_MODULE_HASH);
  assert(present.found);

  const broken =
    "globalThis.dispatch = () => { throw new Error('extractor failed'); };\n";
  const crashed = await runFormat({
    operation: "extract",
    name: "document",
    module_hash: moduleHash(broken),
    bundle: broken,
    input: guestInput("x"),
  }, { timeoutMs: 20_000 });
  assertEquals(crashed.ok, false);
  if (!crashed.ok) assertEquals(crashed.failure, "runner_failed");

  const absent = await runFormat({
    operation: "extract",
    name: "document",
    module_hash: "0".repeat(64),
    bundle: "",
    input: guestInput("x"),
  });
  assertEquals(absent.ok, false);
  if (!absent.ok) assertEquals(absent.failure, "missing_module");
  assert(
    crashed.ok === false && absent.ok === false &&
      crashed.failure !== absent.failure,
  );
});

Deno.test("documents/formats#R18: only two runner processes run at once and a deadline kills the process", async () => {
  let active = 0;
  let peak = 0;
  const request = {
    operation: "extract" as const,
    name: "document" as const,
    module_hash: BUILTIN_MODULE_HASH,
    bundle: "globalThis.dispatch = () => ({ status: 'ready' });\n",
    input: guestInput("x"),
  };
  const slow = () =>
    runFormat({ ...request, module_hash: moduleHash(request.bundle) }, {
      concurrency: 2,
      timeoutMs: 5_000,
      spawn: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 80));
        active -= 1;
        return { ok: true, output: { status: "unsupported" } };
      },
    });
  await Promise.all([slow(), slow(), slow()]);
  assertEquals(peak, 2);
});

Deno.test("documents/formats#R18: the runner process is killed when the deadline passes", async () => {
  const bundle = "globalThis.dispatch = () => { while (true) {} };\n";
  const started = Date.now();
  const killed = await runFormat({
    operation: "extract",
    name: "document",
    module_hash: moduleHash(bundle),
    bundle,
    input: guestInput("x"),
  }, { timeoutMs: 1_500 });
  assertEquals(killed.ok, false);
  if (!killed.ok) {
    assertEquals(killed.failure, "runner_failed");
    assert(
      killed.detail.includes("deadline") || killed.detail.includes("closed"),
    );
  }
  assert(Date.now() - started < 8_000);
});
