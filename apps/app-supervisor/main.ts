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
import type { CoreLink } from "../../packages/apps/runtime/core-link.ts";
import { readRecordState, recordInput } from "./record.ts";
import { createCoreSender, createSupervisorDelivery } from "./delivery.ts";

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
    async record(record) {
      const input = recordInput(record);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/apps/${record.method}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token()}`,
          },
          body: JSON.stringify({
            input,
            idempotency_key: crypto.randomUUID(),
            prepared: [],
          }),
        });
      } catch {
        return {
          ok: false,
          error: { code: "unavailable", message: "core is unreachable" },
        };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "core record response is not valid",
          },
        };
      }
      return readRecordState({ status: response.status, body });
    },
  };
}

// hello frame이 채운다. argv·환경에는 credential이 없다.
const received: { credential: string; verifyKey: string } = {
  credential: "",
  verifyKey: "",
};

const coreUrl = Deno.env.get("LOPHN_CORE_URL") ?? "http://127.0.0.1:7431";

// 앱이 broker로 보낸 invocation 기록을 응답 뒤 유한한 목록으로 core에 전달한다.
// broker 서비스(permissions/broker)가 `delivery.broker.submit`을 부른다.
const delivery = createSupervisorDelivery({
  clock: systemClock,
  send: createCoreSender({
    baseUrl: coreUrl,
    token: () => received.credential,
  }),
  write: (frame) => {
    Deno.stdout.writeSync(frame);
  },
});

const supervisor = createSupervisor({
  clock: systemClock,
  childExited: (nonce) => delivery.childExited(nonce),
  core: coreLink(coreUrl, () => received.credential),
  deno: () => Deno.env.get("LOPHN_DENO") ?? Deno.execPath(),
  environment: {
    ...(Deno.env.get("HOME") ? { home: Deno.env.get("HOME") } : {}),
    ...(Deno.env.get("DENO_DIR") ? { denoDir: Deno.env.get("DENO_DIR") } : {}),
    ...(Deno.env.get("XDG_CACHE_HOME")
      ? { xdgCacheHome: Deno.env.get("XDG_CACHE_HOME") }
      : {}),
    ...(Deno.env.get("PATH") ? { path: Deno.env.get("PATH") } : {}),
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
  // hello가 오기 전에는 빈 값이다. 자식 기동 시점에 읽으므로 hello 뒤 값이 간다.
  verifyKey: () => received.verifyKey,
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

// supervisor가 예상 밖으로 죽어도 detached 앱 자식을 남기지 않는다.
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  void supervisor.stop();
};
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  shutdown();
});

await link.closed;
