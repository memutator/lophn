// npm script의 입구: 인자를 Electron의 Node(`ELECTRON_RUN_AS_NODE=1`)로 돌린다. core를 import하는 test는
// Temporal이 있는 Electron의 Node가 있어야 한다. `ELECTRON_RUN_AS_NODE=1 electron …` 꼴은 cmd.exe에서 돌지 않는다.
// glob(`tests/e2e/*_test.ts`)은 shell이 아니라 Node test runner가 펼친다.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const ELECTRON = createRequire(import.meta.url)("electron") as string;

const child = spawn(ELECTRON, process.argv.slice(2), {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
