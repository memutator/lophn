import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createAlwaysOnOs } from "./mod.ts";

type Answer = { code: number | null; stdout: string; stderr: string };
type Answers = (args: readonly string[]) => Answer | undefined;

const OK: Answer = { code: 0, stdout: "", stderr: "" };
const SECRETS = {
  OPENAI_API_KEY: "sk-test-secret-value-1",
  GITHUB_TOKEN: "ghp_secretTokenValue2",
};
const PATHS = {
  linux: {
    execPath: "/opt/lophn/lophn",
    coreEntry: "/opt/lophn/resources/platform/core/main/daemon/main.ts",
    dataRoot: "/home/me/.lophn",
  },
  darwin: {
    execPath: "/Applications/lophn-desktop.app/Contents/MacOS/lophn-desktop",
    coreEntry:
      "/Applications/lophn-desktop.app/Contents/Resources/platform/core/main/daemon/main.ts",
    dataRoot: "/Users/me/.lophn",
  },
  win32: {
    execPath: "C:\\Users\\me\\AppData\\Local\\Programs\\lophn\\lophn.exe",
    coreEntry:
      "C:\\Users\\me\\AppData\\Local\\Programs\\lophn\\resources\\platform\\core\\main\\daemon\\main.ts",
    dataRoot: "C:\\Users\\me\\.lophn",
  },
} as const;
type Platform = keyof typeof PATHS;

const APPROVED =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// systemctl·launchctl은 `answers`가 답하고(없으면 켜진 상태), reg.exe는 registry Map을 흉내 낸다.
function setup(
  platform: Platform,
  options: { answers?: Answers; execPath?: string } = {},
) {
  const files = new Map<string, string>();
  const registry = new Map<string, { type: string; data: string }>();
  const calls: string[] = [];
  const os = createAlwaysOnOs({
    platform,
    ...PATHS[platform],
    ...(options.execPath ? { execPath: options.execPath } : {}),
    corePid: 4242,
    uid: 501,
    home: platform === "win32" ? "C:\\Users\\me" : "/home/me",
    env: {
      PATH: '/usr/local/bin:/usr/bin:/home/me/$weird:/home/me/bad"dir:/bin',
      TMPDIR: "/var/folders/xy/T/",
      SystemRoot: "C:\\Windows",
      ...SECRETS,
    },
    async exec(file, args) {
      calls.push([file, ...args].join(" "));
      if (file.endsWith("reg.exe")) {
        const at = `${args[1]}|${args[3]}`;
        if (args[0] === "add") {
          registry.set(at, { type: args[5] ?? "", data: args[7] ?? "" });
        }
        if (args[0] === "delete") {
          return registry.delete(at) ? OK : { ...OK, code: 1 };
        }
        if (args[0] === "query") {
          const value = registry.get(at);
          if (!value) return { code: 1, stdout: "", stderr: "ERROR" };
          return {
            ...OK,
            stdout: `\r\n${args[1]}\r\n    ${args[3]}    ${value.type}    ${value.data}\r\n\r\n`,
          };
        }
        return OK;
      }
      const answer = options.answers?.(args);
      if (answer) return answer;
      if (args[1] === "is-enabled") return { ...OK, stdout: "enabled\n" };
      if (args[0] === "print-disabled") return { ...OK, stdout: "{\n}\n" };
      return OK;
    },
    spawn() {
      return { onExit() {}, kill() {} };
    },
    files: {
      async read(path) {
        return files.get(path);
      },
      async write(path, text) {
        files.set(path, text);
      },
      async remove(path) {
        files.delete(path);
      },
    },
    hash,
  });
  return { os, files, calls, registry };
}

const stateOf = (result: { state: string; reason?: string }) =>
  result.state === "unavailable" ? result.reason : result.state;

test("세 OS의 등록 글에는 경로와 정해진 env 이름만 있고 secret 값은 없으며, 안전하지 않은 경로는 쓰지 않는다", async () => {
  const allowed = new Set([
    "ELECTRON_RUN_AS_NODE",
    "LOPHN_HOME",
    "LOPHN_LAUNCH_SHELL",
    "LOPHN_SERVICE",
    "PATH",
    "TMPDIR",
  ]);
  for (const platform of ["linux", "darwin", "win32"] as const) {
    const { os, files, calls, registry } = setup(platform);
    const env = os.captureEnv();
    assert.deepEqual(
      Object.keys(env).sort(),
      platform === "darwin" ? ["PATH", "TMPDIR"] : ["PATH"],
    );
    assert.deepEqual(
      await os.registrar.register(env),
      { state: "registered" },
      platform,
    );
    const written = [
      ...files.values(),
      ...[...registry.values()].map((value) => value.data),
      ...calls,
    ].join("\n");
    for (const [name, value] of Object.entries(SECRETS)) {
      assert.ok(!written.includes(value), `${platform}: ${name} 값`);
      assert.ok(!written.includes(name), `${platform}: ${name} 이름`);
    }
    assert.ok(
      !written.includes('bad"dir'),
      `${platform}: 안전하지 않은 PATH 항목`,
    );
    if (platform === "linux") assert.ok(!written.includes("$weird"), platform);
    const paths = PATHS[platform];
    assert.ok(written.includes(paths.execPath), `${platform}: 실행 경로`);
    assert.ok(written.includes(paths.dataRoot), `${platform}: data root`);
    // Windows Run 값은 Electron이 `--core`로 core를 찾아 띄운다.
    if (platform !== "win32")
      assert.ok(written.includes(paths.coreEntry), platform);
    const text = [...files.values()].join("\n");
    const names = [
      ...[...text.matchAll(/"([A-Z_]+)=/g)].map((match) => match[1]),
      ...[...text.matchAll(/<key>([A-Z_]+)<\/key>/g)].map((match) => match[1]),
    ];
    for (const name of names)
      assert.ok(allowed.has(name ?? ""), `${platform}: ${name}`);
  }

  const unsafe: [Platform, string][] = [
    ["linux", "/opt/lo$phn/lophn"],
    ["linux", "/opt/lo%hn/lophn"],
    ["linux", "/opt/lo`x`/lophn"],
    ["linux", "/opt/lo\\phn/lophn"],
    ["linux", '/opt/lo"phn/lophn'],
    ["linux", "opt/lophn"],
    ["darwin", "/Applications/lo\nphn.app/x"],
    ["darwin", '/Applications/lo"phn.app/x'],
    ["win32", 'C:\\lo"phn\\lophn.exe'],
    ["win32", "C:\\lo\u0007phn\\lophn.exe"],
  ];
  for (const [platform, execPath] of unsafe) {
    const { os, files, calls, registry } = setup(platform, { execPath });
    assert.deepEqual(
      await os.registrar.register(os.captureEnv()),
      { state: "unavailable", reason: "unverified_path" },
      execPath,
    );
    assert.equal(files.size + registry.size + calls.length, 0, execPath);
  }
});

test("OS 답을 registered로 읽는 것은 항목이 있고 같은 글이고 켜져 있을 때뿐이고, unregister는 도는 core를 멈추지 않는다", async () => {
  const label = `dev.lophn.core.${hash(PATHS.darwin.dataRoot).slice(0, 12)}`;
  const isEnabled =
    (answer: Answer): Answers =>
    (args) =>
      args[1] === "is-enabled" ? answer : undefined;
  const printDisabled =
    (stdout: string): Answers =>
    (args) =>
      args[0] === "print-disabled" ? { ...OK, stdout } : undefined;
  const cases: [string, Platform, Answers | undefined, string][] = [
    ["linux enabled", "linux", undefined, "registered"],
    [
      "linux disabled",
      "linux",
      isEnabled({ code: 1, stdout: "disabled\n", stderr: "" }),
      "off_in_system",
    ],
    [
      "linux 모르는 답",
      "linux",
      isEnabled({ code: 0, stdout: "static\n", stderr: "" }),
      "os_failed",
    ],
    [
      "linux 기한 넘김",
      "linux",
      isEnabled({ code: null, stdout: "", stderr: "" }),
      "os_failed",
    ],
    [
      "linux bus 없음",
      "linux",
      isEnabled({
        code: 1,
        stdout: "",
        stderr: "Failed to connect to bus: No medium found\n",
      }),
      "no_service_manager",
    ],
    ["darwin 목록에 없음", "darwin", undefined, "registered"],
    [
      "darwin enabled",
      "darwin",
      printDisabled(
        `{\n\t"dev.lophn.core.other" => disabled\n\t"${label}" => enabled\n}\n`,
      ),
      "registered",
    ],
    [
      "darwin disabled",
      "darwin",
      printDisabled(`{\n\t"${label}" => disabled\n}\n`),
      "off_in_system",
    ],
    [
      "darwin 옛 꼴 true",
      "darwin",
      printDisabled(`{\n\t"${label}" => true\n}\n`),
      "off_in_system",
    ],
    [
      "darwin 실패",
      "darwin",
      () => ({ code: 113, stdout: "", stderr: "" }),
      "os_failed",
    ],
  ];
  for (const [name, platform, answers, expected] of cases) {
    const { os, files, calls } = setup(platform, { answers });
    const env = os.captureEnv();
    assert.deepEqual(await os.registrar.read(env), { state: "absent" }, name);
    await os.registrar.register(env);
    assert.equal(stateOf(await os.registrar.read(env)), expected, name);
    // 지금 쓸 글(여기서는 PATH)과 다르면 stale이다.
    assert.deepEqual(
      await os.registrar.read({ ...env, PATH: "/somewhere/else" }),
      { state: "stale" },
      name,
    );
    calls.length = 0;
    const removed = await os.registrar.unregister();
    if (name === "darwin 실패") {
      // launchctl disable이 실패하면 file을 남겨 사실(항목이 있다)이 그대로 보인다.
      assert.equal(stateOf(removed), "os_failed", name);
      assert.equal(files.size, 1, name);
    } else {
      assert.deepEqual(removed, { state: "absent" }, name);
      assert.equal(files.size, 0, name);
    }
    assert.ok(!/ stop\b|bootout/.test(calls.join("\n")), name);
  }

  // Windows: StartupApproved 값의 첫 byte가 홀수면 사람이 Startup apps에서 껐다.
  const approved: [string | undefined, string][] = [
    [undefined, "registered"],
    ["020000000000000000000000", "registered"],
    ["030000006D1A2B3C4D5E6F00", "off_in_system"],
  ];
  for (const [data, expected] of approved) {
    const { os, registry, calls } = setup("win32");
    const env = os.captureEnv();
    assert.deepEqual(await os.registrar.read(env), { state: "absent" });
    await os.registrar.register(env);
    const value = [...registry.keys()][0]?.split("|")[1];
    if (data)
      registry.set(`${APPROVED}|${value}`, { type: "REG_BINARY", data });
    assert.equal(stateOf(await os.registrar.read(env)), expected, data);
    calls.length = 0;
    assert.deepEqual(await os.registrar.unregister(), { state: "absent" });
    assert.equal(registry.size, 0);
    assert.ok(!/taskkill|stop/.test(calls.join("\n")));
  }
  const { os, registry } = setup("win32");
  await os.registrar.register(os.captureEnv());
  const at = [...registry.keys()][0] ?? "";
  registry.set(at, {
    type: "REG_SZ",
    data: '"C:\\old\\lophn.exe" --core --home "C:\\Users\\me\\.lophn"',
  });
  assert.deepEqual(await os.registrar.read(os.captureEnv()), {
    state: "stale",
  });
});
