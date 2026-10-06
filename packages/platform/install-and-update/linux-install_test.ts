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
    assertFalse(/\bdeno run\b/.test(script.replace('"$ROOT/deno" run', "")));
    for (
      const banned of ["-A ", "--allow-all", "--allow-ffi", "--allow-write"]
    ) {
      assertFalse(script.includes(banned), banned);
    }
    // 실행 권한은 helper 하나뿐이다.
    assertStringIncludes(script, '--allow-run="$ROOT/lophn-credential"');
    assertEquals(script.match(/--allow-run/g)?.length, 1);
    assertStringIncludes(script, "--allow-net=127.0.0.1,[::1]");
  }
  assertStringIncludes(mcpLauncher(layout), "apps/mcp/main.ts");
  assertStringIncludes(cliLauncher(layout), "apps/cli/main.ts");
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
