// 좁은 권한의 core 모양 parent. supervisor-group_test가 이 파일만 좁은 grant로 띄운다:
// --allow-run=<설치된 deno>,/usr/bin/kill --allow-env=NODE_V8_COVERAGE --allow-read=<testdata>.
// shell·C fixture 없이 실제 product spawnProcess·createSupervisor로 group 종료를 확인한다.
import { manualClock } from "../../../../base/mod.ts";
import { encodeFrame, type Frame } from "../../../../protocol/server/mod.ts";
import { readFrames } from "../frames.ts";
import { checkKillAdapter, spawnProcess } from "../process.ts";
import { createSupervisor } from "../supervisor.ts";

const [mode, deno, testdata] = Deno.args;
const entry = `${testdata}child.ts`;
const encoder = new TextEncoder();

const HELLO = {
  type: "hello",
  core_epoch: "epoch-1",
  process_identity: "proc-1",
  kind: "platform/io",
  task: "task-1",
  scope: { operations: ["blob.put"], targets: {} },
  credential: "credential-value-not-for-argv",
  api_port: 7431,
};

const spec = {
  kind: "platform/io",
  entry,
  allow_read: [testdata],
  allow_write: [],
  allow_net: [],
  allow_run: [deno],
  allow_sys: [],
  allow_env: ["LOPHN_FIXTURE_MODE"],
  policy: "always",
  memory_limit_bytes: 1024,
};

function report(value: Record<string, unknown>) {
  Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(value)}\n`));
}

type Pids = { leader: number; grandchild: number };

function pidsOf(frame: Frame): Pids | undefined {
  if (frame.kind !== "json") return undefined;
  const message = frame.payload as { request_id?: string; payload?: Pids };
  return message.request_id === "pids" ? message.payload : undefined;
}

// product spawnProcess로 fixture child를 띄우고 hello를 보낸 뒤 손자 pid를 받는다.
async function launch(fixtureMode: string) {
  const spawned = spawnProcess({
    command: deno,
    args: [
      "run",
      "--no-prompt",
      `--allow-read=${testdata}`,
      `--allow-run=${deno}`,
      "--allow-env=LOPHN_FIXTURE_MODE",
      entry,
    ],
    env: { LOPHN_FIXTURE_MODE: fixtureMode },
  });
  await spawned.stdin.write(
    encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
  );
  for await (const frame of readFrames(spawned.stdout)) {
    const pids = pidsOf(frame);
    if (pids) return { spawned, pids };
  }
  throw new Error("fixture ended without pids");
}

async function waitForLine() {
  const buffer = new Uint8Array(16);
  await Deno.stdin.read(buffer);
}

if (mode === "denied") {
  let spawned = 0;
  const supervised = createSupervisor({
    clock: manualClock(0),
    denoCommand: deno,
    spawn: (request) => {
      spawned += 1;
      return spawnProcess(request);
    },
  });
  const started = await supervised.start(spec, HELLO as never, {
    onMessage: () => {},
  });
  report({
    step: "denied",
    adapter: await checkKillAdapter(),
    started: started.ok,
    code: started.ok ? undefined : started.code,
    spawned,
    reason: supervised.observation("platform/io").reason,
  });
  Deno.exit(0);
}

report({ step: "adapter", ok: await checkKillAdapter() });

// 1. leader가 스스로 끝나도 같은 경계가 손자까지 정리한다. 이미 쓰인 stdout 꼬리도 읽었다.
{
  const { spawned, pids } = await launch("grandchild-exit");
  const code = await spawned.exited;
  const confirmed = await spawned.terminate();
  report({ step: "exit", ...pids, code, confirmed });
}

// 2. 강제 종료. test가 /proc으로 pgid·session을 확인할 때까지 기다린다.
{
  const { spawned, pids } = await launch("grandchild");
  report({ step: "forced-pids", ...pids });
  await waitForLine();
  const confirmed = await spawned.terminate();
  report({ step: "forced", ...pids, confirmed });
}

// 3. supervisor 전체 경로: start → ready → stop이 group 종료를 확인한다.
{
  let pids: Pids | undefined;
  const supervised = createSupervisor({
    clock: manualClock(0),
    denoCommand: deno,
    readyMs: 5_000,
    stopMs: 1_000,
    env: () => ({ LOPHN_FIXTURE_MODE: "grandchild" }),
  });
  const started = await supervised.start(spec, HELLO as never, {
    onMessage: (message) => {
      if (message.type === "worker_response" && message.ok) {
        pids = message.payload as Pids;
      }
    },
  });
  while (started.ok && !pids) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const stopped = await supervised.stop("platform/io");
  report({
    step: "supervised",
    started: started.ok,
    ...pids,
    stopped,
    reason: supervised.observation("platform/io").reason,
  });
}
Deno.exit(0);
