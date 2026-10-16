import { startCore } from "./core.ts";
import { writeParent } from "./parent.ts";
import { startFailureReason } from "../../storage/migration/mod.ts";
import { TEAM_MODULES, TEAMS, WIRINGS } from "./assembly.ts";
import { productKeychain } from "../../secrets/store.ts";
import { credentialLoaderIdentity } from "../../install-and-update/mod.ts";

const portArg = Deno.args.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? undefined : Number(portArg.slice(7));

// Electron main이 물려 준 pipe. 터미널에서 직접 띄우면(stdin이 터미널) 신호로만 끝난다.
const parent = Deno.stdin.isTerminal()
  ? undefined
  : { stdin: Deno.stdin.readable, stdout: Deno.stdout.writable };

const started = await startCore({
  port,
  teams: TEAMS,
  teamModules: TEAM_MODULES,
  wirings: WIRINGS,
  parent,
  // coding agent connection credential은 OS keychain에 둔다. 보호 loader는 설치 묶음의 helper
  // `lophn-credential` 하나이고 identity는 그 고정 절대 경로다(Linux .deb. 다른 OS는 아직 없다).
  codingKeychain: productKeychain(),
  codingLoaders: [credentialLoaderIdentity()],
});
if (!started.ok) {
  console.error(`core: ${started.error.message}`);
  // shell main이 시작 실패 화면에서 이유를 보이게 알린다.
  if (parent) {
    await writeParent(parent, {
      type: "start_failed",
      reason: startFailureReason(started.error),
    }).catch(() => {});
  }
  Deno.exit(1);
}
const core = started.value;
const exitAfterShutdown = () => void core.shutdown().then(() => Deno.exit(0));
Deno.addSignalListener("SIGINT", exitAfterShutdown);
Deno.addSignalListener("SIGTERM", exitAfterShutdown);
await core.done;
