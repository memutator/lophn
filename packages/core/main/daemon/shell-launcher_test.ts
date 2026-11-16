import assert from "node:assert/strict";
import { test } from "node:test";
import { createShellLauncher } from "./shell-launcher.ts";

// 잘못 만든 명령은 개발에서 Electron 기본 앱이, 설치본에서 앱 대신 Node가 뜬다. 시험·boot가 띄운 core가 사람 장치에 앱을 띄우면 안 된다.
const ROOT = "/repo";
const ENTRY = "/repo/packages/shell/main/dist/main.cjs";
const run = async (input: {
  files: string[];
  env?: Record<string, string>;
  platform?: NodeJS.Platform;
  environment?: string | Error;
  throws?: boolean;
}) => {
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] =
    [];
  const errors: unknown[] = [];
  const shown: { file: string; args: readonly string[]; timeoutMs: number }[] =
    [];
  const launch = createShellLauncher({
    platformRoot: ROOT,
    execPath: "/electron",
    platform: input.platform ?? "linux",
    exec: async (file, args, timeoutMs) => {
      shown.push({ file, args, timeoutMs });
      if (input.environment instanceof Error) throw input.environment;
      return { code: 0, stdout: input.environment ?? "" };
    },
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
  await launch?.("/data", (error) => errors.push(error));
  return { launch, calls, errors, shown };
};

test("앱을 띄우는 명령은 개발과 설치본이 다르고, Node 표시를 빼며, 켜지 않은 core는 만들지 않는다", async () => {
  const dev = await run({ files: ["/repo/packages/shell", ENTRY] });
  assert.deepEqual(dev.calls[0]?.args, [
    ENTRY,
    "--home",
    "/data",
    "--agent-window",
  ]);
  assert.equal(dev.calls[0]?.command, "/electron");
  assert.equal(dev.calls[0]?.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(dev.calls[0]?.env.LOPHN_HOME, "/data");

  const sandbox = await run({
    files: ["/repo/packages/shell", ENTRY],
    env: { ELECTRON_NO_SANDBOX: "1" },
  });
  assert.equal(sandbox.calls[0]?.args[0], "--no-sandbox");

  // 설치본의 platform/에는 packages/shell이 없다.
  const packaged = await run({ files: [] });
  assert.deepEqual(packaged.calls[0]?.args, [
    "--home",
    "/data",
    "--agent-window",
  ]);

  // build하지 않은 개발 저장소, 켜지 않은 core.
  assert.equal(
    (await run({ files: ["/repo/packages/shell"] })).launch,
    undefined,
  );
  assert.equal(
    (await run({ files: [], env: { LOPHN_LAUNCH_SHELL: "" } })).launch,
    undefined,
  );

  const failed = await run({ files: [], throws: true });
  assert.equal(failed.errors.length, 1);
});

// OS service가 띄운 core는 화면 세션의 env가 없다. 그 값 없이 앱을 띄우면 Linux에서 창이 안 뜬다.
test("Linux service core는 화면 env가 없을 때만 user manager에서 화면 값을 가져온다", async () => {
  const service = { LOPHN_SERVICE: "1" };
  const shown = [
    "PATH=/usr/bin",
    "DISPLAY=:0",
    "WAYLAND_DISPLAY=wayland-0",
    "XAUTHORITY=/run/user/1000/xauth",
    "XDG_SESSION_TYPE=wayland",
    "XDG_CURRENT_DESKTOP=GNOME",
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
    "OPENAI_API_KEY=sk-secret",
    "",
  ].join("\n");
  const got = await run({ files: [], env: service, environment: shown });
  assert.deepEqual(got.shown, [
    {
      file: "systemctl",
      args: ["--user", "show-environment"],
      timeoutMs: 2000,
    },
  ]);
  const env = got.calls[0]?.env;
  assert.equal(env?.DISPLAY, ":0");
  assert.equal(env?.WAYLAND_DISPLAY, "wayland-0");
  assert.equal(env?.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
  assert.equal(env?.PATH, undefined);
  assert.equal(env?.OPENAI_API_KEY, undefined);

  // user manager가 없으면 지금처럼 띄운다.
  const none = await run({
    files: [],
    env: service,
    environment: new Error("no systemctl"),
  });
  assert.equal(none.calls.length, 1);
  assert.equal(none.errors.length, 0);

  // 화면 env가 이미 있거나 service가 아니거나 Linux가 아니면 묻지 않는다.
  for (const other of [
    run({ files: [], env: { ...service, DISPLAY: ":1" } }),
    run({ files: [] }),
    run({ files: [], env: service, platform: "darwin" }),
  ]) {
    const asked = await other;
    assert.equal(asked.shown.length, 0);
    assert.equal(asked.calls.length, 1);
  }
});
