import assert from "node:assert/strict";
import { test } from "node:test";
import { createShellLauncher } from "./shell-launcher.ts";

// 잘못 만든 명령은 개발에서 Electron 기본 앱이, 설치본에서 앱 대신 Node가 뜬다. 시험·boot가 띄운 core가 사람 장치에 앱을 띄우면 안 된다.
const ROOT = "/repo";
const ENTRY = "/repo/packages/shell/main/dist/main.cjs";
const run = (input: {
  files: string[];
  env?: Record<string, string>;
  throws?: boolean;
}) => {
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] =
    [];
  const errors: unknown[] = [];
  const launch = createShellLauncher({
    platformRoot: ROOT,
    execPath: "/electron",
    env: {
      LOPHN_LAUNCH_SHELL: "1",
      ELECTRON_RUN_AS_NODE: "1",
      ...input.env,
    },
    exists: (path) => input.files.includes(path),
    spawn: (command, args, options) => {
      if (input.throws) throw new Error("spawn failed");
      calls.push({ command, args, env: options.env });
      return { on: () => {}, unref: () => {} };
    },
  });
  launch?.("/data", (error) => errors.push(error));
  return { launch, calls, errors };
};

test("앱을 띄우는 명령은 개발과 설치본이 다르고, Node 표시를 빼며, 켜지 않은 core는 만들지 않는다", () => {
  const dev = run({ files: ["/repo/packages/shell", ENTRY] });
  assert.deepEqual(dev.calls[0]?.args, [
    ENTRY,
    "--home",
    "/data",
    "--agent-window",
  ]);
  assert.equal(dev.calls[0]?.command, "/electron");
  assert.equal(dev.calls[0]?.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(dev.calls[0]?.env.LOPHN_HOME, "/data");

  const sandbox = run({
    files: ["/repo/packages/shell", ENTRY],
    env: { ELECTRON_NO_SANDBOX: "1" },
  });
  assert.equal(sandbox.calls[0]?.args[0], "--no-sandbox");

  // 설치본의 platform/에는 packages/shell이 없다.
  const packaged = run({ files: [] });
  assert.deepEqual(packaged.calls[0]?.args, [
    "--home",
    "/data",
    "--agent-window",
  ]);

  // build하지 않은 개발 저장소, 켜지 않은 core.
  assert.equal(run({ files: ["/repo/packages/shell"] }).launch, undefined);
  assert.equal(
    run({ files: [], env: { LOPHN_LAUNCH_SHELL: "" } }).launch,
    undefined,
  );

  const failed = run({ files: [], throws: true });
  assert.equal(failed.errors.length, 1);
});
