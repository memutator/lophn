import { assert, assertEquals } from "@std/assert";
import {
  DIAGNOSTICS_WRITE_OP,
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../packages/contracts/platform/mod.ts";
import { createPlatformIo } from "./io.ts";

const hello = {
  type: "hello",
  core_epoch: "epoch",
  process_identity: "process",
  kind: "platform/io",
  task: "diagnostics",
  scope: { operations: [DIAGNOSTICS_WRITE_OP], targets: {} },
  credential: "token-never-record",
  api_port: 7431,
};
const diagnostic = {
  type: "diagnostic" as const,
  kind: "lophn_internal" as const,
  payload: {
    component: "platform/core",
    observed_at: "2026-10-04T00:00:00.000Z",
    error_class: "internal_exception" as const,
    location: "core.command",
    count: 1,
  },
};
const request = {
  type: "worker_request",
  request_id: "request",
  op: DIAGNOSTICS_WRITE_OP,
  payload: { records: [diagnostic], dropped: 0 },
};
const frame = (payload: unknown) =>
  encodeFrame({ kind: "json", channel: 0, payload });

Deno.test("platform/diagnostics#R2 platform/redaction#R15 composed authenticated entry writes only safe record", async () => {
  const root = await Deno.makeTempDir({ prefix: "io-entry-" });
  const chunks: Uint8Array[] = [];
  let ended = false;
  let wake: () => void = () => {};
  const output: Frame[] = [];
  const decoder = new FrameDecoder();
  const push = (payload: unknown) => {
    chunks.push(frame(payload));
    wake();
  };
  let run: Promise<void> | undefined;
  try {
    const session = await createPlatformIo({
      root,
      catalog: {
        components: ["platform/core"],
        locations: { "core.command": "core/command" },
      },
      currentAuthority: () => ({
        principal: "core",
        process: "process",
        task: "diagnostics",
        scope: [DIAGNOSTICS_WRITE_OP],
        permits: (value) => value.payload.component === "platform/core",
      }),
      streams: {
        stdin: {
          async read(buffer) {
            while (!chunks.length && !ended) {
              await new Promise<void>((resolve) => wake = resolve);
            }
            const next = chunks.shift();
            if (!next) return null;
            buffer.set(next);
            return next.length;
          },
        },
        stdout: {
          write(bytes) {
            output.push(...decoder.push(bytes));
            return Promise.resolve(bytes.length);
          },
        },
        stderr: { write: (bytes) => Promise.resolve(bytes.length) },
      },
    });
    run = session.run();
    push(hello);
    push(request);
    for (let i = 0; i < 100 && output.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assertEquals(output.length, 2);
    assertEquals(output[1], {
      kind: "json",
      channel: 0,
      payload: {
        type: "worker_response",
        request_id: "request",
        ok: true,
        payload: { accepted: 1, dropped: 0 },
      },
    });
    let contents = "";
    for (let i = 0; i < 100 && !contents; i++) {
      try {
        contents = await Deno.readTextFile(`${root}/logs/platform-0.jsonl`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      if (!contents) await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert(contents.includes("Platform internal failure observed."));
    assert(!contents.includes("token-never-record"));
    push({ type: "stop", grace_ms: 10 });
    await run;
    assertEquals(session.credentialUsable, false);
    assertEquals(
      output.filter((value) =>
        value.kind === "json" &&
        (value.payload as { type: string }).type === "stopped"
      ).length,
      1,
    );
  } finally {
    ended = true;
    wake();
    await run;
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("platform/diagnostics#R3 platform/redaction#R15 real product pipe EOF and stop have no raw stdout", async () => {
  const root = await Deno.makeTempDir({ prefix: "io-pipe-" });
  const entry = new URL("../main.ts", import.meta.url).pathname;
  const config = new URL("../../../deno.json", import.meta.url).pathname;
  try {
    for (const terminal of ["stop", "eof"]) {
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--cached-only",
          "--frozen",
          "--no-prompt",
          `--allow-read=${root}`,
          `--allow-write=${root}/logs`,
          "--config",
          config,
          entry,
          "platform/io",
          root,
        ],
        clearEnv: true,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const writer = child.stdin.getWriter();
      const reader = child.stdout.getReader();
      const decoder = new FrameDecoder();
      const received: Frame[] = [];
      let stderr: Promise<Uint8Array> | undefined;
      try {
        stderr = new Response(child.stderr).bytes();
        await writer.write(frame(hello));
        while (received.length < 1) {
          const next = await reader.read();
          assert(!next.done);
          received.push(...decoder.push(next.value));
        }
        await writer.write(frame(request));
        while (received.length < 2) {
          const next = await reader.read();
          assert(!next.done);
          received.push(...decoder.push(next.value));
        }
        assertEquals(
          (received[1] as { payload: { ok: boolean } }).payload.ok,
          false,
        );
        if (terminal === "stop") {
          await writer.write(frame({ type: "stop", grace_ms: 20 }));
        }
        await writer.close();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          received.push(...decoder.push(next.value));
        }
        decoder.finish();
        assertEquals((await child.status).success, true);
        assertEquals(
          received.filter((value) =>
            value.kind === "json" &&
            (value.payload as { type: string }).type === "stopped"
          ).length,
          1,
        );
        assertEquals((await stderr).length, 0);
      } finally {
        try {
          await writer.close();
        } catch { /* already closed */ }
        writer.releaseLock();
        reader.releaseLock();
        try {
          child.kill("SIGKILL");
        } catch { /* already exited */ }
        await child.status;
        await stderr;
      }
    }
    const entries = [];
    for await (const entry of Deno.readDir(`${root}/logs`)) entries.push(entry);
    assertEquals(entries.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
