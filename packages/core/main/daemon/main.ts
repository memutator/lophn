import process from "node:process";
import { Readable, Writable } from "node:stream";
import { startFailureReason } from "../../storage/migration/mod.ts";
import { TEAM_MODULES, TEAMS, WIRINGS } from "./assembly.ts";
import { startCore } from "./core.ts";
import { writeParent } from "./parent.ts";

// `--standalone`은 ensure가 띄운 core다. stdin을 종료 신호로 읽지 않고, stdout 첫 JSON 줄로만
// 시작 결과를 알린다. 옛 shell main이 띄운 core는 이 표식 없이 parent pipe를 쓴다.
const args = process.argv.slice(2);
const standalone = args.includes("--standalone");
const portArg = args.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

// Electron main이 물려 준 pipe. 터미널에서 직접 띄우면(stdin이 터미널) 신호로만 끝난다.
const parent =
  standalone || process.stdin.isTTY
    ? undefined
    : {
        stdin: Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
        stdout: Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      };

// launcher가 stdout을 먼저 놓아도 core가 EPIPE로 죽지 않는다.
if (standalone) process.stdout.on("error", () => {});

const started = await startCore({
  port,
  teams: TEAMS,
  teamModules: TEAM_MODULES,
  wirings: WIRINGS,
  parent,
});
if (!started.ok) {
  // core의 logger는 기동 실패 전에 만들어졌어도 여기서는 손에 없다. 같은 모양의 줄을 직접 쓴다.
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service_name: "lophn-core",
      component: "core",
      event: "start_failed",
      message: started.error.message,
    })}\n`,
  );
  // shell이 시작 실패 화면에서 이유를 보이게 알린다.
  const reason = startFailureReason(started.error);
  if (standalone) {
    process.stdout.write(
      `${JSON.stringify({ type: "start_failed", reason })}\n`,
    );
  } else if (parent) {
    await writeParent(parent, { type: "start_failed", reason }).catch(() => {});
  }
  process.exit(1);
}
const core = started.value;
// 첫 줄만 읽고 stream을 놓는 launcher에 core가 섰음을 알린다. token은 이 줄에 없다.
if (standalone) process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
const exitAfterShutdown = () =>
  void core.shutdown().then(() => process.exit(0));
process.on("SIGINT", exitAfterShutdown);
process.on("SIGTERM", exitAfterShutdown);
await core.done;
// toWeb stream은 reader를 놓아도 stdin에 읽기 요청을 남겨 event loop를 붙든다. core가 끝났으면 읽기를 멈춰야 process가 끝난다.
if (parent) process.stdin.pause();
if (standalone) process.exit(0);
