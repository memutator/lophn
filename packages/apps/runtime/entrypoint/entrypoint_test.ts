import { assert, assertEquals } from "@std/assert";
import { installCrashExit } from "./crash.ts";
import { main } from "./main.ts";

Deno.test("apps/runtime#R22: unhandled rejection reports, writes stderr, and exits 1", async () => {
  const target = new EventTarget();
  const stderr: string[] = [];
  let code = 0;
  let reported = 0;
  const original = globalThis.addEventListener;
  globalThis.addEventListener = ((type: string, listener: EventListener) => {
    target.addEventListener(type, listener);
  }) as typeof addEventListener;
  try {
    installCrashExit({
      report: () => {
        reported += 1;
        return Promise.reject(new Error("report down"));
      },
      writeStderr: (text) => stderr.push(text),
      exit: (next) => {
        code = next;
      },
    });
    target.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.resolve(),
        reason: new Error("boom"),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.addEventListener = original;
  }
  assertEquals(reported, 1);
  assertEquals(code, 1);
  assert(stderr.join("").includes("boom"));
});

Deno.test("apps/runtime#R22: exception observer is installed before app code loads", async () => {
  const order: string[] = [];
  const dir = await Deno.makeTempDir();
  const socket = `${dir}/a.sock`;
  try {
    await main({
      readLine: () =>
        Promise.resolve(
          JSON.stringify({
            app: "app_01h455vb4pex5v6nkc6gd5fdw1",
            release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
            bundle_hash: "ab".repeat(32),
            mode: "live",
            process_nonce: "nonce-1",
            broker_socket: `${dir}/b.sock`,
            direct_socket: socket,
            data_path: dir,
            broker_credential: "child-cred",
          }),
        ),
      importModule: (specifier) => {
        order.push(specifier);
        return Promise.resolve({
          createExceptionObserver: () => {
            order.push("install");
            return () => undefined;
          },
        });
      },
      key: { verify: () => Promise.resolve(false) },
      blueprint: (await import("./testing.ts")).blueprint(),
      broker: () => Promise.resolve({ status: 503, body: null }),
      dataSchema: 0,
      reportTransport: () => Promise.resolve(undefined),
      exit: () => undefined,
      writeStderr: () => undefined,
    });
    assertEquals(order[0], "@lophn/cap-problem");
    assertEquals(order[1], "install");
    assertEquals(order[2], "@lophn/app");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R22 apps/runtime#R23: entrypoint loads without zod", async () => {
  const dir = await Deno.makeTempDir();
  const map = {
    imports: {
      "@lophn/base": new URL("../../../../base/mod.ts", import.meta.url).href,
      "@lophn/apps/blueprint":
        new URL("../../../blueprint/mod.ts", import.meta.url).href,
    },
  };
  const mapPath = `${dir}/import-map.json`;
  await Deno.writeTextFile(mapPath, JSON.stringify(map));
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-npm",
      "--no-remote",
      "--no-config",
      "--quiet",
      `--import-map=${mapPath}`,
      new URL("./load-check.ts", import.meta.url).pathname,
    ],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  assertEquals(new TextDecoder().decode(result.stdout).trim(), "loaded");
  await Deno.remove(dir, { recursive: true });
});
