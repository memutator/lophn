import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { startFailureReason } from "../../storage/migration/mod.ts";
import { TEAM_MODULES, TEAMS, WIRINGS } from "./assembly.ts";
import { startCore } from "./core.ts";
import { createShellLauncher } from "./shell-launcher.ts";

// core에는 시작 모드가 하나뿐이다. stdin을 수명 신호로 읽지 않고, stdout 첫 JSON 줄로만
// 시작 결과(ready 또는 start_failed)를 알린다. 종료는 control stop·idle-exit·SIGINT/SIGTERM이
// 같은 shutdown barrier로 한다.
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

// launcher가 stdout을 먼저 놓아도 core가 EPIPE로 죽지 않는다.
process.stdout.on("error", () => {});

const started = await startCore({
  port,
  teams: TEAMS,
  teamModules: TEAM_MODULES,
  wirings: WIRINGS,
  launchShell: createShellLauncher({
    platformRoot: fileURLToPath(new URL("../../../..", import.meta.url)),
    execPath: process.execPath,
    env: process.env,
    exists: existsSync,
    spawn: (command, args, options) => spawn(command, args, options),
  }),
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
  // 화면 없이 띄운 쪽이 실패 이유를 보이게 알린다. 문장과 경로는 싣지 않는다.
  const reason = startFailureReason(started.error);
  process.stdout.write(`${JSON.stringify({ type: "start_failed", reason })}\n`);
  process.exit(1);
}
const core = started.value;
// 첫 줄만 읽고 stream을 놓는 launcher에 core가 섰음을 알린다. token은 이 줄에 없다.
process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
const exitAfterShutdown = () =>
  void core.shutdown().then(() => process.exit(0));
process.on("SIGINT", exitAfterShutdown);
process.on("SIGTERM", exitAfterShutdown);
// done은 shutdown barrier가 실제로 끝났을 때 resolve된다.
await core.done;
process.exit(0);
