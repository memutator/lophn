// 공유 앱 supervisor 진입점. core가 platform 신뢰 child 감독 pipe로 띄운다.
// credential은 hello frame 한 번으로만 받고 argv·환경에는 없다. 자식 앱에는 supervisor의
// machine credential을 주지 않고 자식마다 core가 발급한 app credential을 준다.
import { createIdSource, systemClock } from "../../../base/mod.ts";
import { encodeFrame } from "../../../protocol/base/mod.ts";
import {
  CRASH_LOCATIONS,
  crashDiagnostic,
  installCrashHandler,
} from "../../diagnostics/mod.ts";
import {
  createSocketDirectory,
  slotSockets,
  SOCKET_SLOTS,
} from "../../apps/runtime/processes/mod.ts";
import { procRssReader } from "../../apps/runtime/observations/memory.ts";
import { attachControlLink } from "../../apps/runtime/supervisor/mod.ts";
import { assembleSupervisor } from "./assembly.ts";
import { spawnApp } from "./spawn.ts";
import { createPreparationService } from "../../apps/releases/preparation.ts";
import { createChildPreparationRunner } from "./release-runner.ts";
import { createChildDataRunner } from "./data-runner.ts";
import { unixControlTransport } from "./control-http.ts";

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
  return writeFrame(
    encodeFrame({ kind: "json", channel: 0, payload: message }),
  );
}
function writeFrame(bytes: Uint8Array): Promise<void> {
  writing = writing.then(async () => {
    let offset = 0;
    while (offset < bytes.length) {
      offset += await Deno.stdout.write(bytes.subarray(offset));
    }
  });
  return writing;
}

const port: { value: number } = { value: 0 };

// 앱마다 고정 자리의 socket이다(allow-net이 정확한 경로만 받아서 자리를 미리 허락한다).
// 이전 자식이 남긴 socket 파일은 종료 확인 뒤에 지운다.
const slots = new Map<string, number>();
// socket 폴더는 data root마다 나뉘므로 core와 같은 LOPHN_HOME이 있어야 한다.
const dataRoot = Deno.env.get("LOPHN_HOME");
// 앱의 broker·control socket 자리. 자리는 앱마다 한 번 정하고 계속 쓴다. 파일은 건드리지 않는다.
function placeOf(app: string): { broker: string; control: string } {
  let slot = slots.get(app);
  if (slot === undefined) {
    slot = slots.size;
    if (slot >= SOCKET_SLOTS) throw new Error("no free app socket slot");
    slots.set(app, slot);
  }
  if (dataRoot === undefined) throw new Error("LOPHN_HOME is not set");
  const created = createSocketDirectory({
    dataRoot,
    xdgRuntimeDir: Deno.env.get("XDG_RUNTIME_DIR"),
    uid: Deno.uid() ?? 0,
    ensureDir: (path, mode) => Deno.mkdirSync(path, { recursive: true, mode }),
    tempParent: Deno.env.get("TMPDIR") ?? "/tmp",
    randomName: () => "slot",
  });
  if (!created.ok) throw new Error(created.error.message);
  const made = slotSockets(created.value.directory, slot);
  if (!made.ok) throw new Error(made.error.message);
  return { broker: made.value.brokerSocket, control: made.value.controlSocket };
}

// 이전 자식이 남긴 socket 파일은 종료 확인 뒤 새 자식을 띄울 때 지운다.
function socketPathsOf(app: string): { broker: string; control: string } {
  const made = placeOf(app);
  for (const path of [made.broker, made.control]) {
    try {
      Deno.removeSync(path);
    } catch { /* 없으면 지울 것이 없다 */ }
  }
  return made;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const credential: { value: string } = { value: "" };

// release 준비는 core가 data root(LOPHN_HOME)와 함께 띄우는 이 supervisor가 요청마다 좁은 권한의
// 자식으로 돌린다. 진행은 이 프로세스의 메모리다(apps/releases).
const preparation = dataRoot === undefined
  ? undefined
  : createPreparationService(createChildPreparationRunner({
    dataRoot,
    deno: () => Deno.env.get("LOPHN_DENO") ?? Deno.execPath(),
    denoDir: Deno.env.get("DENO_DIR") ??
      `${Deno.env.get("HOME") ?? "/tmp"}/.cache/deno`,
  }));

const assembled = assembleSupervisor({
  ...(preparation === undefined ? {} : { preparation }),
  // activation의 backup·migration·restore는 종료 확인 뒤 앱 전용 data worker가 한다.
  ...(dataRoot === undefined ? {} : {
    data: createChildDataRunner({
      dataRoot,
      deno: () => Deno.env.get("LOPHN_DENO") ?? Deno.execPath(),
      denoDir: Deno.env.get("DENO_DIR") ??
        `${Deno.env.get("HOME") ?? "/tmp"}/.cache/deno`,
    }),
  }),
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
  socketPaths: socketPathsOf,
  nonce: () => crypto.randomUUID(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  spawn: (launch) => spawnApp(launch),
  async post(path, bearer, body) {
    const response = await fetch(
      `http://127.0.0.1:${port.value}/${path}`,
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
  control: unixControlTransport,
  send,
  rss: procRssReader(),
});

const link = attachControlLink(assembled.supervisor, stdin, {
  send,
  ops: assembled.ops,
  onHello(hello) {
    port.value = hello.apiPort;
    credential.value = hello.credential;
    assembled.onHello({
      credential: hello.credential,
      apiPort: hello.apiPort,
    });
  },
  onCredential: (response) => assembled.onCredential(response),
});

// supervisor가 예상 밖으로 죽어도 detached 앱 자식을 남기지 않는다.
// 정지는 한 번만 돈다. 신호와 crash가 겹쳐도 같은 promise를 기다린다.
let stopping: Promise<void> | undefined;
const stopOnce = () => stopping ??= assembled.supervisor.stop();
const shutdown = () => {
  void stopOnce().finally(() => Deno.exit(0));
};
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
installCrashHandler({
  target: globalThis,
  // core에 한 줄 보내고 앱 자식을 정지한 뒤 종료한다. core가 component·location을 정해 log에 쓴다.
  write: async () => {
    await send(crashDiagnostic({
      component: "platform/app-supervisor",
      location: CRASH_LOCATIONS.appSupervisor,
      at: systemClock.now(),
    })).catch(() => {});
    await stopOnce();
  },
  stderr: Deno.stderr.writable,
  redact: (text) => text,
  exit: Deno.exit,
  // 앱 정지 유예(10초)와 강제 종료 확인이 들어갈 시간이다.
  deadlineMs: 15_000,
});

await link.closed;
assembled.shutdown();
// 열린 timer(관측·ready 기한)가 남아 있어도 core가 끝난 supervisor는 끝낸다.
Deno.exit(0);
