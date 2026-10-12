import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import {
  cliLauncher,
  debControl,
  denoCacheDir,
  desktopEntry,
  LINUX_DEPENDS,
  LINUX_LAUNCHERS,
  linuxInstallLayout,
  mcpLauncher,
  postinstScript,
} from "./linux-install.ts";

const layout = linuxInstallLayout();

Deno.test("platform/install-and-update#R4: 설치 묶음은 /opt/lophn 아래 Deno·platform·desktop·skills·sdk·guides를 둔다", () => {
  assertEquals(layout, {
    root: "/opt/lophn",
    deno: "/opt/lophn/deno",
    platform: "/opt/lophn/platform",
    desktop: "/opt/lophn/desktop",
    skills: "/opt/lophn/skills",
    sdk: "/opt/lophn/sdk",
    guides: "/opt/lophn/guides",
    credentialHelper: "/opt/lophn/lophn-credential",
    desktopBinary: "/opt/lophn/lophn-desktop",
    chromeSandbox: "/opt/lophn/chrome-sandbox",
  });
  assertEquals(linuxInstallLayout("/opt/x/"), linuxInstallLayout("/opt/x"));
});

Deno.test("platform/install-and-update#R6: 세 실행 이름은 /usr/bin에 있다", () => {
  assertEquals(LINUX_LAUNCHERS, {
    desktop: "/usr/bin/lophn-desktop",
    cli: "/usr/bin/lophn",
    mcp: "/usr/bin/lophn-mcp",
  });
  assertStringIncludes(desktopEntry(), "Exec=/usr/bin/lophn-desktop %U");
  assertStringIncludes(desktopEntry(), "x-scheme-handler/lophn");
});

Deno.test("platform/install-and-update#R4, R5: CLI·MCP launcher는 설치된 Deno를 cached-only·frozen으로 쓴다", () => {
  for (const script of [cliLauncher(layout), mcpLauncher(layout)]) {
    assertStringIncludes(
      script,
      'exec "$ROOT/deno" run --cached-only --frozen',
    );
    assertStringIncludes(script, '--config="$ROOT/platform/deno.json"');
    // 시스템 Deno·다운로드·일반 권한은 없다.
    assertFalse(/\bdeno run\b/.test(script.replace(/"\$ROOT\/deno" run/g, "")));
    for (const banned of ["-A ", "--allow-all", "--allow-ffi"]) {
      assertFalse(script.includes(banned), banned);
    }
    assertStringIncludes(script, "--allow-net=127.0.0.1,[::1]");
  }
  // MCP는 쓰기 없이 helper 실행 하나뿐이다.
  const mcp = mcpLauncher(layout);
  assertFalse(mcp.includes("--allow-write"));
  assertStringIncludes(mcp, '--allow-run="$ROOT/lophn-credential"');
  assertEquals(mcp.match(/--allow-run/g)?.length, 1);
  assertStringIncludes(mcp, "apps/mcp/main.ts");
  assertStringIncludes(cliLauncher(layout), "apps/cli/main.ts");
});

// platform/install-and-update#R4, R5의 CLI 정확한 경로 권한(open-issues coding-agent/mcp-server#Q9)이다.
// 만든 launcher를 임시 설치 root에서 실제로 실행하고, 설치 Deno 자리의 대역이 받은 argv를 읽는다.
type LauncherRun = { planner: string[]; final: string[] };

async function runCliLauncher(
  args: string[],
  plan: string,
  env: Record<string, string>,
): Promise<LauncherRun> {
  const root = await Deno.makeTempDir({ prefix: "lophn-launcher-root-" });
  const log = `${root}/argv.log`;
  try {
    const fake = linuxInstallLayout(root);
    await Deno.writeTextFile(`${root}/lophn`, cliLauncher(fake));
    await Deno.chmod(`${root}/lophn`, 0o755);
    // 설치 Deno 대역이다. 받은 인자를 한 줄씩 남기고 계획 entry에는 준비한 flag를 내보낸다.
    await Deno.writeTextFile(
      `${root}/deno`,
      [
        "#!/bin/sh",
        'case "$*" in',
        `  *apps/cli/launch.ts*) printf '%s\\n' "$@" >> "${log}.planner"; printf '%s' "$FAKE_PLAN" ;;`,
        `  *) printf '%s\\n' "$@" >> "${log}.final" ;;`,
        "esac",
        "",
      ].join("\n"),
    );
    await Deno.chmod(`${root}/deno`, 0o755);
    const home = `${root}/home`;
    await Deno.mkdir(home);
    const out = await new Deno.Command(`${root}/lophn`, {
      args,
      clearEnv: true,
      env: {
        HOME: home,
        LOPHN_HOME: `${home}/.lophn`,
        FAKE_PLAN: plan,
        ...env,
      },
      stdout: "null",
      stderr: "null",
    }).output();
    assertEquals(out.code, 0);
    const read = async (path: string) => {
      try {
        return (await Deno.readTextFile(path)).split("\n").filter((l) =>
          l !== ""
        );
      } catch {
        return [];
      }
    };
    return {
      planner: (await read(`${log}.planner`)).map((l) =>
        l.replaceAll(home, "<HOME>").replaceAll(root, "<ROOT>")
      ),
      final: (await read(`${log}.final`)).map((l) =>
        l.replaceAll(home, "<HOME>").replaceAll(root, "<ROOT>")
      ),
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("platform/install-and-update#R4, R5: CLI launcher는 정확한 경로의 write·run·PATH read만 열고 일반 write·run·-A는 없다", async () => {
  const run = await runCliLauncher(
    ["document", "list"],
    "",
    { PATH: "/usr/bin:relative/bin:/opt/a,b:/usr/local/bin" },
  );
  // 설치·sdk 명령이 아니면 권한 계획을 부르지 않는다.
  assertEquals(run.planner, []);
  const argv = run.final;
  assertEquals(argv.slice(0, 5), [
    "run",
    "--cached-only",
    "--frozen",
    "--no-prompt",
    "--config=<ROOT>/platform/deno.json",
  ]);
  const flag = (name: string) =>
    argv.filter((a) => a.startsWith(`--allow-${name}=`));
  // 읽기: 설치 묶음·cache·run·integrations·cwd·proc와 PATH의 절대 폴더(쉼표가 든 폴더·상대 폴더는 뺀다).
  assertEquals(flag("read").length, 1);
  const read = flag("read")[0].slice("--allow-read=".length).split(",");
  assertEquals(read.slice(0, 2), [
    "<ROOT>/platform",
    "<HOME>/.cache/lophn/deno",
  ]);
  assertEquals(read.slice(2, 4), [
    "<HOME>/.lophn/run",
    "<HOME>/.lophn/integrations",
  ]);
  assertEquals(read.slice(-2), ["/usr/bin", "/usr/local/bin"]);
  // 제품 감지가 PATH 뒤에 읽는 home 기준 bin 폴더도 정확한 폴더다.
  for (const dir of [".local/bin", ".bun/bin", ".local/share/mise/shims"]) {
    assert(read.includes(`<HOME>/${dir}`), dir);
  }
  assert(read.includes("/proc/self/stat"));
  assertFalse(read.includes("relative/bin"));
  // 쓰기: integrations 폴더와 instance lock 파일뿐이다.
  assertEquals(flag("write"), [
    "--allow-write=<HOME>/.lophn/integrations,<HOME>/.lophn/run/instance.lock",
  ]);
  // 실행: helper·설치 Deno·lophn-desktop뿐이다.
  assertEquals(flag("run"), [
    "--allow-run=<ROOT>/lophn-credential,<ROOT>/deno,<ROOT>/lophn-desktop",
  ]);
  const envFlag = flag("env")[0].slice("--allow-env=".length).split(",");
  for (
    const name of [
      "PATH",
      "XDG_RUNTIME_DIR",
      "TMPDIR",
      "CODEX_HOME",
      "XDG_CONFIG_HOME",
      "HERMES_HOME",
    ]
  ) assert(envFlag.includes(name), name);
  assertEquals(flag("net"), ["--allow-net=127.0.0.1,[::1]"]);
  for (
    const banned of [
      "-A",
      "--allow-all",
      "--allow-ffi",
      "--allow-write",
      "--allow-run",
      "--allow-sys",
    ]
  ) {
    assertFalse(argv.includes(banned), banned);
  }
  assertEquals(argv.at(-3), "<ROOT>/platform/apps/cli/main.ts");
  assertEquals(argv.slice(-2), ["document", "list"]);
});

Deno.test("platform/install-and-update#R4, R5: 설치·sdk 명령은 권한 계획의 정확한 파일 flag만 더해 실행한다", async () => {
  const plan = [
    "--allow-read=<H>/.claude.json,<H>/.claude.json.lophn-tmp",
    "--allow-write=<H>/.claude.json,<H>/.claude.json.lophn-tmp",
  ].join("\n");
  const run = await runCliLauncher(
    ["harness", "install", "--input", "{}"],
    plan,
    { PATH: "/usr/bin" },
  );
  // 계획은 읽기·loopback·helper 실행뿐이고 쓰기·일반 실행이 없다.
  assertEquals(run.planner.filter((a) => a.startsWith("--allow-write")), []);
  assertEquals(
    run.planner.filter((a) => a.startsWith("--allow-run")),
    ["--allow-run=<ROOT>/lophn-credential"],
  );
  assert(run.planner.includes("<ROOT>/platform/apps/cli/launch.ts"));
  // 최종 실행에는 계획이 낸 두 flag가 flag 그대로 더해진다. 합쳐진 값이나 새 권한은 없다.
  const extra = run.final.filter((a) => a.includes("<H>/.claude.json"));
  assertEquals(extra, plan.split("\n"));
  assertFalse(run.final.includes("--allow-all"));
  assertEquals(run.final.filter((a) => a.startsWith("--allow-run=")).length, 1);
  // 계획이 아무것도 못 내면 고정 권한만으로 실행한다.
  const empty = await runCliLauncher(["sdk", "add"], "", { PATH: "/usr/bin" });
  assertEquals(
    empty.final.filter((a) => a.startsWith("--allow-write=")).length,
    1,
  );
  assertEquals(
    empty.final.filter((a) => a.startsWith("--allow-read=")).length,
    1,
  );
});

Deno.test("platform/install-and-update#R8: launcher의 Deno cache는 ~/.cache/lophn/deno이고 데이터 폴더 밖이다", () => {
  assertEquals(denoCacheDir("/home/a/"), "/home/a/.cache/lophn/deno");
  for (const script of [cliLauncher(layout), mcpLauncher(layout)]) {
    assertStringIncludes(script, 'DENO_DIR="${HOME}/.cache/lophn/deno"');
    assertStringIncludes(script, 'H="${LOPHN_HOME:-$HOME/.lophn}"');
  }
});

Deno.test("platform/install-and-update#R3, platform/security#R4: postinst는 sandbox 파일을 root 소유 4755로 두고 아니면 설치를 멈춘다", () => {
  const script = postinstScript(layout);
  assertStringIncludes(script, "SANDBOX=/opt/lophn/chrome-sandbox");
  assertStringIncludes(script, 'chown root:root "$SANDBOX"');
  assertStringIncludes(script, 'chmod 4755 "$SANDBOX"');
  assertStringIncludes(script, '!= "0:0 4755"');
  assertStringIncludes(script, "exit 1");
  // sandbox를 끄는 대안은 어디에도 없다.
  for (
    const text of [
      script,
      cliLauncher(layout),
      mcpLauncher(layout),
      desktopEntry(),
    ]
  ) {
    assertFalse(text.includes("no-sandbox"));
    assertFalse(text.includes("disable-setuid-sandbox"));
  }
});

Deno.test("platform/install-and-update#R4: control은 Electron 실행 의존성과 secret-tool을 선언한다", () => {
  const control = debControl({ version: "0.1.0", installedSizeKb: 1234 });
  assertStringIncludes(control, "Package: lophn\n");
  assertStringIncludes(control, "Version: 0.1.0\n");
  assertStringIncludes(control, "Architecture: amd64\n");
  assertStringIncludes(control, "Installed-Size: 1234\n");
  assert(LINUX_DEPENDS.includes("libsecret-tools"));
  assertStringIncludes(control, `Depends: ${LINUX_DEPENDS.join(", ")}`);
  // Deno는 묶음에 있으므로 시스템 Deno에 의존하지 않는다.
  assertFalse(control.toLowerCase().includes("deno,"));
});

Deno.test("platform/install-and-update#R4, R5: 권한 계획 process도 PATH의 절대 폴더와 감지 bin 폴더를 읽기만 연다(refresh 실행 파일 감지)", async () => {
  const run = await runCliLauncher(
    ["harness", "refresh"],
    "",
    { PATH: "/usr/bin:relative/bin:/opt/a,b:/usr/local/bin" },
  );
  // 계획 process의 읽기 목록: 설치 묶음·run·cwd·proc 뒤에 PATH 절대 폴더와 home 기준 bin 폴더가 정확히 든다.
  const plannerRead = run.planner.filter((a) => a.startsWith("--allow-read="));
  assertEquals(plannerRead.length, 1);
  const read = plannerRead[0].slice("--allow-read=".length).split(",");
  assert(read.includes("/usr/bin"));
  assert(read.includes("/usr/local/bin"));
  assertFalse(read.includes("relative/bin"));
  assertFalse(read.includes("/opt/a"));
  for (const dir of [".local/bin", ".bun/bin", ".local/share/mise/shims"]) {
    assert(read.includes(`<HOME>/${dir}`), dir);
  }
  // 계획 process는 쓰기 없이 helper 실행 하나뿐이다.
  assertEquals(run.planner.filter((a) => a.startsWith("--allow-write")), []);
  assertEquals(
    run.planner.filter((a) => a.startsWith("--allow-run")),
    ["--allow-run=<ROOT>/lophn-credential"],
  );
});
