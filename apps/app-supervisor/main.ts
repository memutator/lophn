// 공유 앱 supervisor 진입점. core가 platform 신뢰 child 감독 pipe로 띄운다.
// credential은 hello frame 한 번으로만 받고 argv·환경에는 없다. 자식 앱에는 supervisor의
// machine credential을 주지 않고 자식마다 core가 발급한 app credential을 준다.
import { createIdSource, systemClock } from "../../packages/base/mod.ts";
import { encodeFrame } from "../../packages/contracts/platform/mod.ts";
import { createSocketDirectory } from "../../packages/apps/runtime/processes/mod.ts";
import { procRssReader } from "../../packages/apps/runtime/observations/memory.ts";
import { attachControlLink } from "../../packages/apps/runtime/supervisor/mod.ts";
import { assembleSupervisor } from "./assembly.ts";
import { spawnApp } from "./spawn.ts";

const stdin: { read(buffer: Uint8Array): Promise<number | null> } = {
  async read(buffer) {
    const chunk = new Uint8Array(buffer.length);
    const count = await Deno.stdin.read(chunk);
    if (count === null) return null;
    buffer.set(chunk.subarray(0, count));
    return count;
  },
};

// stdout은 frame 전용이다. 쓰기는 호출 순서대로 이어서 frame이 섞이지 않게 한다.
let writing: Promise<void> = Promise.resolve();
function send(message: unknown): Promise<void> {
  const bytes = encodeFrame({ kind: "json", channel: 0, payload: message });
  writing = writing.then(async () => {
    let offset = 0;
    while (offset < bytes.length) {
      offset += await Deno.stdout.write(bytes.subarray(offset));
    }
  });
  return writing;
}

const port: { value: number } = { value: 0 };

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const assembled = assembleSupervisor({
  clock: systemClock,
  ids: createIdSource({
    clock: systemClock,
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
  }),
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
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  spawn: (launch) => spawnApp(launch),
  async post(path, bearer, body) {
    const response = await fetch(
      `http://127.0.0.1:${port.value}/v1/${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await readBody(response) };
  },
  async direct(endpoint, request) {
    // 앱 socket HTTP다. 가상 host lophn.invalid만 쓴다(apps/runtime#R8).
    const client = Deno.createHttpClient({
      proxy: { transport: "unix", path: endpoint },
    });
    try {
      const response = await fetch(`http://lophn.invalid${request.path}`, {
        client,
        method: request.method,
        headers: {
          authorization: request.authorization,
          ...(request.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
      });
      return { status: response.status, body: await readBody(response) };
    } finally {
      client.close();
    }
  },
  send,
  rss: procRssReader(),
});

const link = attachControlLink(assembled.supervisor, stdin, {
  send,
  ops: assembled.ops,
  onHello(hello) {
    port.value = hello.apiPort;
    assembled.onHello({
      credential: hello.credential,
      apiPort: hello.apiPort,
      verifyKey: hello.verifyKey,
    });
  },
  onCredential: (response) => assembled.onCredential(response),
});

// supervisor가 예상 밖으로 죽어도 detached 앱 자식을 남기지 않는다.
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  void assembled.supervisor.stop().finally(() => Deno.exit(0));
};
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  shutdown();
});

await link.closed;
assembled.shutdown();
// 열린 timer(관측·ready 기한)가 남아 있어도 core가 끝난 supervisor는 끝낸다.
Deno.exit(0);
