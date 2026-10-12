// supervisor 테스트가 띄우는 fixture child. 동작은 환경 이름으로 고른다.
// entry가 실제 console/stdin/stdout/stderr를 조립한다(child.ts는 console을 건드리지 않는다).
import { type ChildSession, type ChildStreams, startChild } from "../child.ts";

const mode = Deno.env.get("LOPHN_FIXTURE_MODE") ?? "normal";
const encoder = new TextEncoder();

// console.* 교체는 실제로 real stderr에 간다. 한 곳에만 쓴다.
function redirectConsoleToStderr() {
  const write = (args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(" ");
    Deno.stderr.writeSync(encoder.encode(`${line}\n`));
  };
  console.log = (...args) => write(args);
  console.info = (...args) => write(args);
  console.debug = (...args) => write(args);
  console.warn = (...args) => write(args);
  console.error = (...args) => write(args);
}
redirectConsoleToStderr();

function streams(): ChildStreams {
  return {
    stdin: { read: (buffer) => Deno.stdin.read(buffer) },
    stdout: { write: (bytes) => Deno.stdout.write(bytes) },
    stderr: { write: (bytes) => Deno.stderr.write(bytes) },
  };
}

// 같은 process group에 남는 손자. 부모의 stdout(감독 pipe)을 그대로 쥐고 아무것도 쓰지 않는다.
function spawnGrandchild(): number {
  const grandchild = new Deno.Command(Deno.execPath(), {
    args: ["eval", "setInterval(() => {}, 1000)"],
    stdin: "null",
    stdout: "inherit",
    stderr: "null",
    clearEnv: true,
  }).spawn();
  return grandchild.pid;
}

if (mode === "junk") {
  const session = startChild(streams(), {
    onHello: () => {},
    onStop: () => {},
  });
  const running = session.run();
  // frame이 아닌 stdout은 부모가 protocol 위반으로 멈춘다.
  await Deno.stdout.write(encoder.encode("not a frame\n"));
  await running.catch(() => {});
  Deno.exit(0);
}

if (mode === "die") Deno.exit(2);

if (mode === "silent") {
  const session = startChild(streams(), {
    onHello: () => {},
    onStop: () => {},
  });
  await session.run();
  Deno.exit(0);
}

// onHello가 끝나지 않아도 부모 pipe EOF를 보고 onStop을 부른 뒤 끝나야 한다.
if (mode === "hang-hello") {
  const session: ChildSession = startChild(streams(), {
    onHello: () => new Promise(() => {}),
    onStop: () => {
      Deno.stderr.writeSync(
        encoder.encode(`stop credential=${session.credentialUsable}\n`),
      );
    },
  });
  await session.run().catch(() => {});
  Deno.exit(0);
}

const session: ChildSession = startChild(streams(), {
  onHello: (message) => {
    // credential은 stderr에 남기지 않는다. kind만 확인한다.
    Deno.stderr.writeSync(encoder.encode(`hello seen for ${message.kind}\n`));
  },
  onStop: async () => {
    await session.send({ type: "stopped" });
  },
});
const running = session.run();

while (!session.credentialUsable && !session.stopped) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
if (session.stopped) Deno.exit(0);

if (mode === "grandchild" || mode === "grandchild-exit") {
  const grandchild = spawnGrandchild();
  await session.send({ type: "ready" });
  await session.send({
    type: "worker_response",
    request_id: "pids",
    ok: true,
    payload: { leader: Deno.pid, grandchild },
  });
  if (mode === "grandchild-exit") Deno.exit(0);
  await running;
  Deno.exit(0);
}

await session.send({ type: "ready" });

if (mode === "report") {
  await session.send({
    type: "worker_response",
    request_id: "req-1",
    ok: true,
    payload: { echoed: true },
  });
}

if (mode === "chunk") {
  await session.sendBytes(7, encoder.encode("blob-bytes"));
}

if (mode === "crash") Deno.exit(3);
await running;
Deno.exit(0);
