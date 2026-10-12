// CLI launcher의 정확한 경로 권한 시험이다(coding-agent/cli#R30 #R40 #R8, open-issues
// coding-agent/mcp-server#Q9). 실행 argv가 정해진 grant만 갖는지, 사람이 고른 target·앱에서 정확한 파일
// 경로가 계산되는지, 그 argv의 실제 CLI process가 temp PATH에서 감지하고 고른 temp 설정 파일만 쓰며 다른
// 경로 쓰기·실행은 거절되는지 본다. helper는 temp의 sh script 대역이고 core는 같은 process 안 loopback
// 서버 대역이다. 사람의 실제 home·data root·harness 설정·keychain은 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  CLI_ENV_NAMES,
  cliLaunchArgv,
  cliStaticFlags,
  planSelection,
  selectionFlags,
} from "../../packages/coding-agent/cli/mod.ts";
import type {
  CliLaunchInputs,
  CliSelection,
} from "../../packages/coding-agent/cli/mod.ts";
import { DETECTION_FALLBACK_DIRS } from "../../packages/coding-agent/harnesses/mod.ts";
import {
  cliLauncher,
  linuxInstallLayout,
} from "../../packages/core/install-and-update/mod.ts";
import { planCliPermissions } from "./launch.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const TOKEN = "t".repeat(43);
const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

const SHOWN = {
  connection: {
    id: CAC,
    label: "claude",
    scope: { kind: "all", app: null },
    principal: `coding_agent:${CAC}`,
    state: "active",
    revision: "1",
  },
  as_of_seq: "1",
  next_cursor: null,
};

function target(harness: string, extra: Record<string, unknown> = {}) {
  return {
    scope_kind: "user",
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    harness_id: harness,
    app: null,
    app_realpath: null,
    ...extra,
  };
}

function inputs(base: string): CliLaunchInputs {
  return {
    deno: `${base}/install/deno`,
    resources: `${base}/install/platform`,
    cache: `${base}/home/.cache/lophn/deno`,
    home: `${base}/home`,
    dataRoot: `${base}/home/.lophn`,
    desktop: `${base}/install/lophn-desktop`,
    credentialHelper: `${base}/install/lophn-credential`,
    instanceLock: `${base}/home/.lophn/run/instance.lock`,
    cwd: `${base}/work`,
    pathDirs: [`${base}/bin`],
    loopback: ["127.0.0.1", "[::1]"],
  };
}

function flagValue(argv: readonly string[], name: string): string[] {
  return argv.filter((arg) => arg.startsWith(`--allow-${name}=`)).flatMap((
    arg,
  ) => arg.slice(`--allow-${name}=`.length).split(","));
}

Deno.test("coding-agent/cli#R40 coding-agent/cli#R8: CLI argv의 grant는 정확한 경로·파일뿐이고 -A·일반 write·run이 없다", () => {
  const base = "/b";
  const argv = cliLaunchArgv(inputs(base), {
    harnessFiles: [`${base}/home/.claude.json`],
    sdkSourceDirs: [`${base}/apps/notes`],
  }, ["harness", "install"]);
  assertEquals(argv.command, `${base}/install/deno`);
  const args = argv.args;
  assertEquals(args.slice(0, 5), [
    "run",
    "--cached-only",
    "--frozen",
    "--no-prompt",
    `--config=${base}/install/platform/deno.json`,
  ]);
  for (
    const banned of [
      "-A",
      "--allow-all",
      "--allow-ffi",
      "--allow-sys",
      "--allow-import",
    ]
  ) assertFalse(args.includes(banned), banned);
  // 일반 형태(값 없는 --allow-write·--allow-run)는 없다.
  for (const flag of ["--allow-write", "--allow-run", "--allow-read"]) {
    assertFalse(args.includes(flag), flag);
  }
  // 쓰기: 고른 설정 파일(과 temp 이름), integrations, 앱 source의 deno.json·deno.lock, instance lock이다.
  assertEquals(flagValue(args, "write"), [
    `${base}/home/.lophn/integrations`,
    `${base}/home/.lophn/run/instance.lock`,
    `${base}/home/.claude.json`,
    `${base}/home/.claude.json.lophn-tmp`,
    `${base}/apps/notes/deno.json`,
    `${base}/apps/notes/deno.lock`,
  ]);
  // 실행: helper·설치 Deno·lophn-desktop 세 파일이다.
  assertEquals(flagValue(args, "run"), [
    `${base}/install/lophn-credential`,
    `${base}/install/deno`,
    `${base}/install/lophn-desktop`,
  ]);
  // 읽기: 쓰는 파일과 설치 묶음·cache·run·integrations·cwd·proc·PATH 폴더다.
  const read = flagValue(args, "read");
  for (
    const path of [
      `${base}/install/platform`,
      `${base}/home/.lophn/run`,
      `${base}/home/.lophn/integrations`,
      `${base}/work`,
      "/proc/self/stat",
      `${base}/bin`,
      `${base}/home/.claude.json`,
      `${base}/apps/notes/deno.lock`,
    ]
  ) assert(read.includes(path), path);
  // 홈·data root·harness 홈 전체는 읽기·쓰기 어느 쪽에도 없다.
  for (const list of [read, flagValue(args, "write")]) {
    for (
      const wide of [`${base}/home`, `${base}/home/.lophn`, "/", `${base}/apps`]
    ) {
      assertFalse(list.includes(wide), wide);
    }
  }
  // 환경: 요구한 이름만이다.
  assertEquals(
    flagValue(args, "env"),
    [...CLI_ENV_NAMES],
  );
  for (
    const name of [
      "PATH",
      "XDG_RUNTIME_DIR",
      "TMPDIR",
      "CODEX_HOME",
      "XDG_CONFIG_HOME",
      "HERMES_HOME",
    ]
  ) assert(CLI_ENV_NAMES.includes(name as never), name);
  assertEquals(flagValue(args, "net"), ["127.0.0.1", "[::1]"]);
  assertEquals(args.slice(-3), [
    `${base}/install/platform/apps/cli/main.ts`,
    "harness",
    "install",
  ]);
  // 선택이 없으면 고정 권한만이다.
  const plain =
    cliLaunchArgv(inputs(base), { harnessFiles: [], sdkSourceDirs: [] }, [])
      .args;
  assertEquals(flagValue(plain, "write"), [
    `${base}/home/.lophn/integrations`,
    `${base}/home/.lophn/run/instance.lock`,
  ]);
  assertEquals(selectionFlags({ harnessFiles: [], sdkSourceDirs: [] }), []);
  assertEquals(
    cliStaticFlags(inputs(base)).filter((flag) =>
      flag.startsWith("--allow-write")
    ).length,
    1,
  );
});

Deno.test("coding-agent/cli#R40 coding-agent/cli#R8: launcher script의 고정 권한은 CLI argv 계산과 같은 이름·폴더를 쓴다", () => {
  const script = cliLauncher(linuxInstallLayout("/opt/lophn"));
  for (const dir of DETECTION_FALLBACK_DIRS) {
    assert(script.includes(`$HOME/${dir}`), dir);
  }
  for (const name of CLI_ENV_NAMES) assert(script.includes(name), name);
  assert(script.includes(CLI_ENV_NAMES.join(",")));
  const flags = cliStaticFlags(inputs("/b"));
  // 쓰기·실행 목록의 모양이 script와 같다(설치 Deno·desktop·helper, integrations·instance lock).
  assert(
    script.includes(
      '--allow-run="$ROOT/lophn-credential,$ROOT/deno,$ROOT/lophn-desktop"',
    ),
  );
  assert(script.includes('WRITE="$H/integrations,$H/run/instance.lock"'));
  assertEquals(
    flags.find((flag) => flag.startsWith("--allow-write")),
    "--allow-write=/b/home/.lophn/integrations,/b/home/.lophn/run/instance.lock",
  );
});

Deno.test("coding-agent/cli#R40 coding-agent/harnesses#R6: 고른 target 하나의 정확한 설정 파일만 계산되고 범위 밖은 아무것도 더하지 않는다", async () => {
  const roots = (env: Record<string, string> = {}) => ({
    home: "/h",
    env: { get: (name: string) => env[name] },
    cwd: "/work",
  });
  const none = { sourceDirOf: () => Promise.resolve(undefined) };
  const files = async (
    command: string,
    input: Record<string, unknown>,
    env: Record<string, string> = {},
  ) =>
    (await planSelection({ command, input, roots: roots(env) }, none))
      .harnessFiles;
  assertEquals(
    await files("harness install", { target: target("claude") }),
    ["/h/.claude.json"],
  );
  // CODEX_HOME·XDG_CONFIG_HOME·HERMES_HOME은 그 제품의 root를 바꾼다. 다른 제품 파일은 나오지 않는다.
  assertEquals(
    await files("harness install", { target: target("codex") }, {
      CODEX_HOME: "/c",
    }),
    ["/c/config.toml"],
  );
  assertEquals(
    await files("connection install", { target: target("opencode") }, {
      XDG_CONFIG_HOME: "/x",
    }),
    ["/x/opencode/opencode.json"],
  );
  assertEquals(
    await files("harness update", { target: target("hermes") }, {
      HERMES_HOME: "/e",
    }),
    ["/e/config.yaml"],
  );
  // 앱 범위는 고른 앱의 실제 폴더 안 정확한 파일만이다(cwd가 아니다).
  const app = await files("harness install", {
    target: target("claude", {
      scope_kind: "app",
      app: "app_01arz3ndektsv4rrffq69g5fav",
      app_realpath: "/apps/notes",
    }),
  });
  assert(app.length >= 1);
  for (const path of app) assert(path.startsWith("/apps/notes/"), path);
  // 쓰기 command가 아니거나 target이 없거나 root가 정해지지 않으면 아무것도 더하지 않는다.
  assertEquals(await files("harness detect", { target: target("claude") }), []);
  assertEquals(await files("harness install", {}), []);
  assertEquals(
    await files("harness install", { target: target("claude") }, {}).then((
      list,
    ) => list.length),
    1,
  );
  const relative = await planSelection({
    command: "harness install",
    input: { target: target("codex") },
    roots: roots({ CODEX_HOME: "relative/codex" }),
  }, none);
  assertEquals(relative.harnessFiles, []);
  // sdk source는 apply와 앱이 있고 core가 source를 알 때만 deno.json·deno.lock 두 파일이다.
  const sdk = {
    sourceDirOf: (app: string) =>
      Promise.resolve(app === "notes" ? "/apps/notes/" : undefined),
  };
  const flags = async (input: Record<string, unknown>) =>
    selectionFlags(
      await planSelection({ command: "sdk add", input, roots: roots() }, sdk),
    );
  assertEquals(await flags({ app: "notes", apply: true }), [
    "--allow-read=/apps/notes/deno.json,/apps/notes/deno.lock",
    "--allow-write=/apps/notes/deno.json,/apps/notes/deno.lock",
  ]);
  assertEquals(await flags({ app: "notes" }), []);
  assertEquals(await flags({ app: "other", apply: true }), []);
  assertEquals(await flags({ apply: true }), []);
  const wild = { sourceDirOf: () => Promise.resolve("/apps/../etc") };
  assertEquals(
    await planSelection({
      command: "sdk add",
      input: { app: "n", apply: true },
      roots: roots(),
    }, wild),
    { harnessFiles: [], sdkSourceDirs: [] },
  );
});

Deno.test("coding-agent/cli#R30: 권한 계획은 core가 알려 준 앱 source의 deno.json·deno.lock만 연다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cli-plan-" });
  const helper = `${dir}/lophn-credential`;
  await Deno.writeTextFile(
    helper,
    `#!/bin/sh\ncat > /dev/null\nprintf '%s' '{"token":"${TOKEN}"}'\n`,
  );
  await Deno.chmod(helper, 0o755);
  try {
    const asked: string[] = [];
    const answer = (source: string | null) => (input: unknown) => {
      asked.push(String(input));
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        bytes: new TextEncoder().encode(JSON.stringify({
          app: {
            id: "app_01arz3ndektsv4rrffq69g5fav",
            slug: "notes",
            name: "notes",
            description: "notes app",
            planning_version: null,
            source_path: source,
            active_release: null,
            revision: "1",
            run_enabled: false,
            status: "active",
          },
          as_of_seq: "1",
          next_cursor: null,
        })),
      });
    };
    const options = (source: string | null) => ({
      env: {
        get: (name: string) =>
          ({
            HOME: dir,
            LOPHN_HOME: `${dir}/.lophn`,
            LOPHN_DAEMON_URL: "http://127.0.0.1:9",
          })[name],
      },
      cwd: dir,
      home: dir,
      installRoot: dir,
      fetch: answer(source),
    });
    const argv = [
      "sdk",
      "add",
      "--connection",
      CAC,
      "--app",
      "app_01arz3ndektsv4rrffq69g5fav",
      "--input",
      JSON.stringify({
        name: "@lophn/ui-table",
        version: "1.2.0",
        apply: true,
      }),
    ];
    // helper는 token을 한 번 주고 core는 앱의 source를 알려 준다.
    const flags = await planCliPermissions(argv, options("/apps/notes"));
    assertEquals(flags, [
      "--allow-read=/apps/notes/deno.json,/apps/notes/deno.lock",
      "--allow-write=/apps/notes/deno.json,/apps/notes/deno.lock",
    ]);
    // 연결된 source가 없으면 아무것도 더하지 않는다.
    assertEquals(await planCliPermissions(argv, options(null)), []);
    // apply가 없거나 쓰지 않는 command면 core를 부르지도 않는다.
    asked.length = 0;
    assertEquals(
      await planCliPermissions(
        argv.map((a) =>
          a.includes("apply")
            ? JSON.stringify({ name: "@lophn/ui-table", version: "1.2.0" })
            : a
        ),
        options("/apps/notes"),
      ),
      [],
    );
    assertEquals(
      await planCliPermissions(["harness", "detect"], options("/apps/notes")),
      [],
    );
    assertEquals(asked, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---- 실제 CLI process ----

type World = {
  base: string;
  home: string;
  dataRoot: string;
  bin: string;
  install: string;
  server: Deno.HttpServer;
  port: number;
};

async function world(): Promise<World> {
  const base = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-cli-launch-" }),
  );
  const home = `${base}/home`;
  const bin = `${base}/bin`;
  const install = `${base}/install`;
  await Deno.mkdir(`${home}/.lophn/run`, { recursive: true });
  await Deno.mkdir(`${home}/.cache/lophn/deno`, { recursive: true });
  await Deno.mkdir(bin);
  await Deno.mkdir(`${base}/work`);
  await Deno.mkdir(install);
  // 설치 묶음 대역: platform은 이 저장소의 source 사본(CLI는 자기 위치에서 설치 root를 정한다), helper는
  // token을 주는 sh script, deno는 현재 Deno다.
  await Deno.mkdir(`${install}/platform`);
  const copied = await new Deno.Command("cp", {
    args: [
      "-r",
      `${REPO}/apps`,
      `${REPO}/packages`,
      `${REPO}/tools`,
      `${REPO}/deno.json`,
      `${REPO}/deno.lock`,
      `${install}/platform/`,
    ],
  }).output();
  assertEquals(copied.code, 0);
  await Deno.symlink(Deno.execPath(), `${install}/deno`);
  await Deno.writeTextFile(
    `${install}/lophn-credential`,
    // PATH가 temp bin 하나뿐이라 외부 명령 없이 shell 내장만 쓴다.
    `#!/bin/sh\nread -r _ || true\nprintf '%s' '{"token":"${TOKEN}"}'\n`,
  );
  await Deno.chmod(`${install}/lophn-credential`, 0o755);
  // PATH의 감지할 실행 파일이다.
  for (const name of ["claude", "codex"]) {
    await Deno.writeTextFile(`${bin}/${name}`, "#!/bin/sh\nexit 0\n");
    await Deno.chmod(`${bin}/${name}`, 0o755);
  }
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    () => Response.json(SHOWN),
  );
  return {
    base,
    home,
    dataRoot: `${home}/.lophn`,
    bin,
    install,
    server,
    port: server.addr.port,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

function launchInputs(w: World): CliLaunchInputs {
  return {
    deno: `${w.install}/deno`,
    resources: `${w.install}/platform`,
    // launcher의 `$DENO_DIR`다. Deno가 PATH 앞에 붙이는 `$DENO_DIR/node_compat_bin`도 이 읽기 안에 있다.
    cache: DENO_DIR,
    home: w.home,
    dataRoot: w.dataRoot,
    desktop: `${w.install}/lophn-desktop`,
    credentialHelper: `${w.install}/lophn-credential`,
    instanceLock: `${w.dataRoot}/run/instance.lock`,
    cwd: `${w.base}/work`,
    pathDirs: [w.bin],
    loopback: ["127.0.0.1", "[::1]"],
  };
}

const DENO_DIR = Deno.env.get("DENO_DIR") ??
  `${Deno.env.get("HOME")}/.cache/deno`;

function processEnv(w: World): Record<string, string> {
  return {
    HOME: w.home,
    LOPHN_HOME: w.dataRoot,
    PATH: w.bin,
    // Deno 자신이 transpile cache를 찾는 값이다. CLI 권한(`--allow-read`)과는 따로다.
    DENO_DIR,
    LOPHN_DAEMON_URL: `http://127.0.0.1:${w.port}`,
  };
}

async function runCli(
  w: World,
  selection: CliSelection,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const argv = cliLaunchArgv(launchInputs(w), selection, args);
  const result = await new Deno.Command(argv.command, {
    args: argv.args,
    cwd: `${w.base}/work`,
    clearEnv: true,
    env: processEnv(w),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    code: result.code,
    out: decode(result.stdout),
    err: decode(result.stderr),
  };
}

// launcher가 먼저 부르는 권한 계획 process다. 읽기·loopback·helper 실행뿐이고 쓰기·일반 실행이 없다.
async function runPlanner(w: World, args: string[]): Promise<string[]> {
  const inputs = launchInputs(w);
  const result = await new Deno.Command(inputs.deno, {
    args: [
      "run",
      "--cached-only",
      "--frozen",
      "--no-prompt",
      `--config=${inputs.resources}/deno.json`,
      `--allow-read=${inputs.resources},${inputs.cache},${w.dataRoot}/run,${inputs.cwd},/proc/self/stat`,
      `--allow-env=${CLI_ENV_NAMES.join(",")}`,
      "--allow-net=127.0.0.1,[::1]",
      `--allow-run=${inputs.credentialHelper}`,
      `${inputs.resources}/apps/cli/launch.ts`,
      ...args,
    ],
    cwd: inputs.cwd,
    clearEnv: true,
    env: processEnv(w),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).split("\n").filter((l) =>
    l !== ""
  );
}

Deno.test("coding-agent/cli#R40 coding-agent/harnesses#R2 coding-agent/cli#R8: 실제 CLI process는 temp PATH에서 감지하고 고른 설정 파일만 쓰며 다른 경로 쓰기는 거절된다", async () => {
  const w = await world();
  try {
    // 감지: PATH 폴더만 읽고 저장 결과는 integrations에만 쓴다.
    const detected = await runCli(w, { harnessFiles: [], sdkSourceDirs: [] }, [
      "harness",
      "detect",
      "--json",
    ]);
    assertEquals(detected.code, 0, detected.out + detected.err);
    const data = JSON.parse(detected.out).data;
    const claude = data.detections.find((item: { harness_id: string }) =>
      item.harness_id === "claude"
    );
    assertEquals(claude.discovery, "detected", JSON.stringify(claude));
    assertEquals(data.cache_saved, true);
    assert(await exists(`${w.dataRoot}/integrations/detection.json`));

    // 설치: launcher의 권한 계획 process가 사람의 선택(claude user target)에서 정확한 파일 하나를 계산한다.
    const installArgs = [
      "harness",
      "install",
      "--connection",
      CAC,
      "--json",
      "--input",
      JSON.stringify({
        target: target("claude"),
        components: ["mcp"],
        operation_id: "op-launch-1",
      }),
    ];
    const planned = await runPlanner(w, installArgs);
    assertEquals(
      planned,
      selectionFlags({
        harnessFiles: [`${w.home}/.claude.json`],
        sdkSourceDirs: [],
      }),
    );
    assertEquals(planned.length, 2);
    const selection: CliSelection = {
      harnessFiles: [`${w.home}/.claude.json`],
      sdkSourceDirs: [],
    };
    // 감지·설치가 아닌 command는 계획이 아무것도 더하지 않는다.
    assertEquals(await runPlanner(w, ["harness", "detect"]), []);
    const installed = await runCli(w, selection, installArgs);
    assertEquals(installed.code, 0, installed.out + installed.err);
    const claudeJson = await Deno.readTextFile(`${w.home}/.claude.json`);
    assert(claudeJson.includes(CAC));
    assertFalse(claudeJson.includes(TOKEN));
    assert(await exists(`${w.dataRoot}/integrations`));
    // temp 파일은 남지 않고 고르지 않은 제품·파일은 만들지 않았다.
    assertFalse(await exists(`${w.home}/.claude.json.lophn-tmp`));
    assertFalse(await exists(`${w.home}/.codex`));

    // 권한 계산 밖의 target을 같은 argv로 설치하면 쓰지 못하고 아무것도 만들어지지 않는다.
    const codexArgs = [...installArgs];
    codexArgs[codexArgs.length - 1] = JSON.stringify({
      target: target("codex"),
      components: ["mcp"],
      operation_id: "op-launch-2",
    });
    const denied = await runCli(w, selection, codexArgs);
    assertFalse(
      denied.code === 0 && JSON.parse(denied.out).data?.status === "complete",
      denied.out + denied.err,
    );
    assertFalse(await exists(`${w.home}/.codex`));
    assertEquals(await Deno.readTextFile(`${w.home}/.claude.json`), claudeJson);
  } finally {
    await w.server.shutdown();
    await Deno.remove(w.base, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R40: 같은 권한의 process는 고른 파일·integrations·instance lock 밖에는 쓰지 못하고 정해진 실행 밖은 실행하지 못한다", async () => {
  const w = await world();
  try {
    const selected = `${w.home}/.claude.json`;
    const probe = `${w.base}/probe.ts`;
    await Deno.writeTextFile(
      probe,
      `
      const out: Record<string, string> = {};
      async function attempt(name: string, work: () => Promise<unknown>) {
        try { await work(); out[name] = "ok"; }
        catch (error) { out[name] = (error as Error).name; }
      }
      const [home, data, bin] = Deno.args;
      await attempt("selected", () => Deno.writeTextFile(home + "/.claude.json", "{}"));
      await attempt("selected_temp", () => Deno.writeTextFile(home + "/.claude.json.lophn-tmp", "{}"));
      await attempt("integrations", () => Deno.writeTextFile(data + "/integrations/x.json", "{}"));
      await attempt("lock", () => Deno.writeTextFile(data + "/run/instance.lock", ""));
      await attempt("sibling", () => Deno.writeTextFile(home + "/.claude.json.bak", "{}"));
      await attempt("other_home", () => Deno.writeTextFile(home + "/other.txt", "x"));
      await attempt("other_harness", () => Deno.writeTextFile(home + "/.codex/config.toml", "x"));
      await attempt("data_root", () => Deno.writeTextFile(data + "/lophn.db", "x"));
      await attempt("run_other", () => Deno.writeTextFile(data + "/run/location.json", "x"));
      await attempt("mkdir", () => Deno.mkdir(home + "/.gemini", { recursive: true }));
      await attempt("remove_other", () => Deno.remove(home + "/victim.txt"));
      await attempt("read_unselected", () => Deno.readTextFile(home + "/victim.txt"));
      await attempt("read_path_dir", async () => { for await (const _ of Deno.readDir(bin)) break; });
      await attempt("run_sh", async () => { await new Deno.Command("/bin/sh", { args: ["-c", "true"] }).output(); });
      await attempt("run_path_tool", async () => { await new Deno.Command(bin + "/claude").output(); });
      console.log(JSON.stringify(out));
      `,
    );
    await Deno.writeTextFile(`${w.home}/victim.txt`, "keep");
    await Deno.mkdir(`${w.dataRoot}/integrations`, { recursive: true });
    const inputs = launchInputs(w);
    const result = await new Deno.Command(`${w.install}/deno`, {
      args: [
        "run",
        "--no-prompt",
        ...cliStaticFlags(inputs).filter((flag) =>
          !flag.startsWith("--allow-env")
        ),
        ...selectionFlags({ harnessFiles: [selected], sdkSourceDirs: [] }),
        `--allow-read=${probe}`,
        probe,
        w.home,
        w.dataRoot,
        w.bin,
      ],
      clearEnv: true,
      env: { DENO_DIR: processEnv(w).DENO_DIR },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(result.stdout);
    assertEquals(
      result.code,
      0,
      text + new TextDecoder().decode(result.stderr),
    );
    const out = JSON.parse(text.trim().split("\n").at(-1) ?? "{}");
    // 허락된 것이다.
    for (
      const name of [
        "selected",
        "selected_temp",
        "integrations",
        "lock",
        "read_path_dir",
      ]
    ) {
      assertEquals(out[name], "ok", name);
    }
    // 그 밖은 모두 거절된다.
    for (
      const name of [
        "sibling",
        "other_home",
        "other_harness",
        "data_root",
        "run_other",
        "mkdir",
        "remove_other",
        "read_unselected",
        "run_sh",
        "run_path_tool",
      ]
    ) assertEquals(out[name], "NotCapable", name);
    assertEquals(await Deno.readTextFile(`${w.home}/victim.txt`), "keep");
    assertFalse(await exists(`${w.home}/other.txt`));
    assertFalse(await exists(`${w.home}/.codex`));
    assertFalse(await exists(`${w.home}/.gemini`));
  } finally {
    await w.server.shutdown();
    await Deno.remove(w.base, { recursive: true });
  }
});

Deno.test("coding-agent/cli#R8 coding-agent/harnesses#R2: harness refresh만 감지가 찾은 제품 실행 파일의 정확한 경로를 --allow-run으로 더하고 다른 command와 감지 없음에는 더하지 않는다", async () => {
  // temp PATH에 가짜 claude 파일만 둔다. 실제 제품·실제 home은 열지 않는다(감지는 읽기만 한다).
  const dir = await Deno.makeTempDir({ prefix: "lophn-refresh-run-" });
  try {
    await Deno.mkdir(`${dir}/bin`);
    await Deno.mkdir(`${dir}/empty`);
    const claude = `${dir}/bin/claude`;
    await Deno.writeTextFile(claude, "#!/bin/sh\nexit 0\n");
    await Deno.chmod(claude, 0o755);
    const plan = (argv: string[], path: string) =>
      planCliPermissions(argv, {
        env: {
          get: (name: string) =>
            ({ PATH: path, HOME: dir, LOPHN_HOME: `${dir}/.lophn` })[name],
        },
        cwd: dir,
        home: dir,
      });
    const onBin = `${dir}/bin`;
    // refresh는 감지 경로 하나만 정확히 더한다. 일반 `--allow-run`·폴더 prefix는 없다.
    assertEquals(await plan(["harness", "refresh"], onBin), [
      `--allow-run=${claude}`,
    ]);
    // detect와 install은 제품 실행 파일을 더하지 않는다(install은 설정 파일 쓰기만 더한다).
    assertEquals(await plan(["harness", "detect"], onBin), []);
    const install = await plan(
      [
        "harness",
        "install",
        "--input",
        JSON.stringify({
          target: target("claude"),
          components: ["mcp"],
          operation_id: "op_refresh_run",
        }),
      ],
      onBin,
    );
    assert(install.length > 0);
    assertFalse(install.some((flag) => flag.startsWith("--allow-run")));
    // 감지가 없으면(PATH에 제품이 없으면) refresh도 아무것도 더하지 않는다.
    assertEquals(await plan(["harness", "refresh"], `${dir}/empty`), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
