// 공유 앱 supervisor 진입점. core가 전용 pipe로 띄운다.
// credential은 hello frame 한 번으로만 받고 argv·환경에는 없다.
import { systemClock } from "../../packages/base/mod.ts";
import { createSocketDirectory } from "../../packages/apps/runtime/processes/mod.ts";
import { spawnApp } from "./spawn.ts";
import type { AppChild } from "../../packages/apps/runtime/supervisor/mod.ts";
import {
  attachControlLink,
  createSupervisor,
} from "../../packages/apps/runtime/supervisor/mod.ts";
import type {
  CoreLink,
  RuntimeRecord,
} from "../../packages/apps/runtime/core-link.ts";

const stdin: { read(buffer: Uint8Array): Promise<number | null> } = {
  async read(buffer) {
    const chunk = new Uint8Array(buffer.length);
    const count = await Deno.stdin.read(chunk);
    if (count === null) return null;
    buffer.set(chunk.subarray(0, count));
    return count;
  },
};

function coreLink(baseUrl: string, token: () => string): CoreLink {
  return {
    async record(record: RuntimeRecord) {
      const method = record.method;
      const input = record.method === "record_started"
        ? { app: record.app, attestation: record.attestation }
        : record.method === "record_stopped"
        ? {
          app: record.app,
          release: record.release,
          process_nonce: record.process_nonce,
          termination_confirmed: true,
        }
        : {
          app: record.app,
          release: record.release,
          ...(record.process_nonce
            ? { process_nonce: record.process_nonce }
            : {}),
          reason: record.reason,
        };
      const response = await fetch(`${baseUrl}/v1/apps/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        }),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: { code: "unavailable", message: "core record failed" },
        };
      }
      const body = await response.json();
      return {
        ok: true,
        value: { state: String(body.output?.state?.state ?? "") },
      };
    },
  };
}

// hello frame이 채운다. argv·환경에는 credential이 없다.
const received: { credential: string; verifyKey: string } = {
  credential: "",
  verifyKey: "",
};

const supervisor = createSupervisor({
  clock: systemClock,
  core: coreLink(
    Deno.env.get("LOPHN_CORE_URL") ?? "http://127.0.0.1:7431",
    () => received.credential,
  ),
  deno: () => Deno.env.get("LOPHN_DENO") ?? Deno.execPath(),
  environment: {
    home: Deno.env.get("HOME") ?? "",
    denoDir: Deno.env.get("DENO_DIR") ?? "",
    xdgCacheHome: Deno.env.get("XDG_CACHE_HOME") ?? "",
    path: Deno.env.get("PATH") ?? "",
  },
  socketPaths: () => {
    const created = createSocketDirectory({
      xdgRuntimeDir: Deno.env.get("XDG_RUNTIME_DIR"),
      uid: Deno.uid() ?? 0,
      ensureDir: (path, mode) =>
        Deno.mkdirSync(path, { recursive: true, mode }),
      tempParent: Deno.env.get("TMPDIR") ?? "/tmp",
      randomName: () => crypto.randomUUID().replaceAll("-", ""),
    });
    if (!created.ok) throw new Error(created.error.message);
    return {
      broker: created.value.brokerSocket,
      direct: created.value.directSocket,
    };
  },
  nonce: () => crypto.randomUUID(),
  credential: () => received.credential,
  verifyKey: received.verifyKey,
  async spawn(request) {
    const child = await spawnApp({
      deno: request.deno,
      entry: request.entry,
      flags: request.flags,
      importMap: request.importMap,
      environment: request.environment,
      startLine: request.startLine,
    });
    const appChild: AppChild = {
      identity: {
        pid: child.pid,
        startedAtMs: request.identity.startedAtMs,
        processNonce: request.identity.processNonce,
      },
      exited: child.exited,
      terminate: () => child.terminate(),
    };
    return appChild;
  },
  probe: () => Promise.resolve({ ok: false, reason: "probe is not wired" }),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const link = attachControlLink(supervisor, stdin, (hello) => {
  received.credential = hello.credential;
  received.verifyKey = hello.verifyKey;
});
await link.closed;
