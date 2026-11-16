// OS 등록의 순수 부분: 이름, 등록 글, OS 답 읽기. platform은 인자로 받는다(platform.md 지키는 것 3).
import { posix } from "node:path";
import type { ServiceEnv } from "./mod.ts";

export type ServicePaths = {
  execPath: string;
  coreEntry: string;
  dataRoot: string;
};

// 제어 문자와 따옴표는 어디서나 받지 않는다. Linux는 systemd quoting·specifier에 걸리는 글자도 받지 않는다.
// escape 규칙에 기대지 않고 등록 자체를 거절한다(fail closed).
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자와 따옴표를 등록 전에 거절한다.
const UNSAFE = /[\u0000-\u001f\u007f"]/;
const UNSAFE_SYSTEMD = /[`$\\%]/;

function unsafe(platform: NodeJS.Platform, text: string): boolean {
  return (
    UNSAFE.test(text) || (platform === "linux" && UNSAFE_SYSTEMD.test(text))
  );
}

function absolute(platform: NodeJS.Platform, path: string): boolean {
  return platform === "win32"
    ? /^[A-Za-z]:\\/.test(path)
    : path.startsWith("/");
}

/** 등록에 쓸 수 있는 경로인가. 아니면 `unverified_path`다. */
export function safePaths(
  platform: NodeJS.Platform,
  paths: ServicePaths,
): boolean {
  return [paths.execPath, paths.coreEntry, paths.dataRoot].every(
    (path) => absolute(platform, path) && !unsafe(platform, path),
  );
}

/** 안전하지 않은 글자가 든 PATH 항목과 빈 항목(현재 폴더)만 뺀다. */
function servicePath(platform: NodeJS.Platform, path: string): string {
  return path
    .split(":")
    .filter((entry) => entry.length > 0 && !unsafe(platform, entry))
    .join(":");
}

/**
 * data root마다 하나인 key. socket 자리와 같은 규칙이다: hash 앞 12자, win32는 구분자 `\`·끝 구분자 없음·소문자로
 * 맞춘 뒤 hash한다. 같은 폴더를 다른 꼴로 받아도 항목이 둘 생기지 않는다.
 */
export function serviceKey(
  platform: NodeJS.Platform,
  dataRoot: string,
  hash: (text: string) => string,
): string {
  const root =
    platform === "win32"
      ? dataRoot.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase()
      : dataRoot;
  return hash(root).slice(0, 12);
}

// --- Linux systemd user unit

export const systemdUnitName = (key: string) => `lophn-core-${key}.service`;

export function systemdUnitPath(
  home: string,
  configHome: string | undefined,
  key: string,
): string {
  const base =
    configHome?.startsWith("/") === true
      ? configHome
      : posix.join(home, ".config");
  return posix.join(base, "systemd", "user", systemdUnitName(key));
}

export function systemdUnit(paths: ServicePaths, env: ServiceEnv): string {
  const environment = [
    "ELECTRON_RUN_AS_NODE=1",
    `LOPHN_HOME=${paths.dataRoot}`,
    "LOPHN_LAUNCH_SHELL=1",
    "LOPHN_SERVICE=1",
    `PATH=${servicePath("linux", env.PATH)}`,
  ];
  return [
    "[Unit]",
    `Description=lophn (${paths.dataRoot})`,
    // 앱을 지운 뒤 남은 unit은 아무것도 하지 않는다.
    `ConditionPathExists=${paths.execPath}`,
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart="${paths.execPath}" "${paths.coreEntry}" --port=0`,
    `Environment=${environment.map((value) => `"${value}"`).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "KillMode=mixed",
    // core 종료 기한 90초보다 길어 정상 종료를 자르지 않는다.
    "TimeoutStopSec=120",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

const NO_BUS =
  /Failed to connect to (user scope )?bus|System has not been booted with systemd/;

/** user bus에 못 붙었다(systemd 없는 배포판, WSL, user manager 없는 session). */
export const systemdNoBus = (stderr: string) => NO_BUS.test(stderr);

/** `systemctl --user is-enabled`의 첫 줄. 모르는 답은 null이다. */
export function systemdEnabled(
  stdout: string,
): "registered" | "off_in_system" | null {
  const state = stdout.trim().split("\n")[0]?.trim();
  if (state === "enabled") return "registered";
  if (state === "disabled" || state === "masked") return "off_in_system";
  return null;
}

// --- macOS LaunchAgent

export const launchdLabel = (key: string) => `dev.lophn.core.${key}`;

export const launchdPlistPath = (home: string, label: string) =>
  posix.join(home, "Library", "LaunchAgents", `${label}.plist`);

const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

// 앱을 지운 뒤 남은 plist가 실패를 되풀이하지 않게, 실행 파일이 없으면 0으로 끝난다(KeepAlive는 실패 때만 다시 띄운다).
const LAUNCH_GUARD = '[ -x "$0" ] || exit 0; exec "$0" "$@"';

export function launchdPlist(
  label: string,
  paths: ServicePaths,
  env: ServiceEnv,
): string {
  const variables: [string, string][] = [
    ["ELECTRON_RUN_AS_NODE", "1"],
    ["LOPHN_HOME", paths.dataRoot],
    ["LOPHN_LAUNCH_SHELL", "1"],
    ["LOPHN_SERVICE", "1"],
    ["PATH", servicePath("darwin", env.PATH)],
  ];
  // core control socket 자리가 os.tmpdir()에서 나오므로 앱이 찾는 자리와 같아야 한다.
  if (env.TMPDIR && !unsafe("darwin", env.TMPDIR)) {
    variables.push(["TMPDIR", env.TMPDIR]);
  }
  const args = [
    "/bin/sh",
    "-c",
    LAUNCH_GUARD,
    paths.execPath,
    paths.coreEntry,
    "--port=0",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xml(label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${xml(arg)}</string>`),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...variables.flatMap(([name, value]) => [
      `    <key>${name}</key>`,
      `    <string>${xml(value)}</string>`,
    ]),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>LimitLoadToSessionType</key>",
    "  <string>Aqua</string>",
    // core가 agent turn과 앱 build를 돌린다. 기본값(Standard 아래 Background 취급)은 CPU·IO를 줄인다.
    "  <key>ProcessType</key>",
    "  <string>Interactive</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/**
 * `launchctl print-disabled gui/<uid>`에서 그 label이 꺼져 있는가. macOS 13부터 `=> disabled|enabled`,
 * 그 전은 `=> true|false`(true가 꺼짐)다. 목록에 없으면 기본값인 켜짐이다.
 */
export function launchdDisabled(stdout: string, label: string): boolean {
  for (const line of stdout.split("\n")) {
    const match = /^\s*"([^"]+)"\s*=>\s*(\w+)/.exec(line);
    if (match?.[1] === label) {
      return match[2] === "disabled" || match[2] === "true";
    }
  }
  return false;
}

// --- Windows HKCU Run

export const RUN_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const APPROVED_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

export const windowsRunName = (key: string) => `lophn-core-${key}`;

/**
 * Electron이 `--core`로 ensure만 하고 끝난다. env는 Explorer의 것이라 ServiceEnv를 싣지 않는다.
 * 끝 구분자를 뺀다: `"C:\x\"`의 `\"`는 따옴표 escape로 읽힌다.
 */
export function windowsRunValue(paths: ServicePaths): string {
  const root = paths.dataRoot.replace(/[\\/]+$/, "");
  return `"${paths.execPath}" --core --home "${root}"`;
}

/** `reg query <key> /v <name>`의 그 값 줄. 없으면 undefined. */
export function regValue(
  stdout: string,
  name: string,
): { type: string; data: string } | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(`    ${name}    `)) continue;
    const match = /^ {4}(REG_\w+) {4}(.*)$/.exec(line.slice(4 + name.length));
    if (match?.[1] && match[2] !== undefined) {
      return { type: match[1], data: match[2] };
    }
  }
  return undefined;
}

/** StartupApproved 값(REG_BINARY hex)의 첫 byte가 홀수면 사람이 Startup apps에서 껐다. */
export function startupApprovedOff(data: string): boolean | null {
  const first = /^[0-9A-Fa-f]{2}/.exec(data.trim())?.[0];
  return first === undefined ? null : (Number.parseInt(first, 16) & 1) === 1;
}

/** Windows env 이름은 대소문자를 가리지 않는다. */
export function systemRoot(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const name = Object.keys(env).find(
    (key) => key.toLowerCase() === "systemroot",
  );
  return (name && env[name]) || "C:\\Windows";
}

// --- keep-awake

export type KeepAwakeCommand = {
  file: string;
  args: string[];
  /** child가 스스로 끝났을 때 알릴 이유. */
  lost: "no_inhibitor" | "os_failed";
};

/**
 * 저절로 잠들기만 막는 child. 모두 core pid에 묶여 core가 SIGKILL돼도 풀린다. 덮개 닫기·Sleep 메뉴·화면 끄기는
 * 막지 않는다(Linux `sleep`만, macOS `-i`만, Windows `ES_SYSTEM_REQUIRED`만).
 */
export function keepAwakeCommand(
  platform: NodeJS.Platform,
  corePid: number,
  systemRoot: string,
): KeepAwakeCommand | undefined {
  if (platform === "linux") {
    return {
      file: "systemd-inhibit",
      args: [
        "--what=sleep",
        "--who=lophn",
        "--why=Keep lophn running",
        "--mode=block",
        "tail",
        `--pid=${corePid}`,
        "-f",
        "/dev/null",
      ],
      lost: "no_inhibitor",
    };
  }
  if (platform === "darwin") {
    return {
      file: "/usr/bin/caffeinate",
      args: ["-i", "-w", String(corePid)],
      lost: "os_failed",
    };
  }
  if (platform === "win32") {
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED = 0x80000001. PowerShell은 hex literal을 int32로 읽어 음수가 되므로
    // 10진으로 쓴다. -ExecutionPolicy를 주지 않는다: -Command 글은 script file 정책에 걸리지 않는다(지키는 것 13).
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Add-Type -Namespace Lophn -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'`,
      "if ([Lophn.Power]::SetThreadExecutionState([uint32]2147483649) -eq 0) { exit 1 }",
      `Wait-Process -Id ${corePid}`,
    ].join("; ");
    return {
      file: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      args: ["-NoProfile", "-NonInteractive", "-Command", script],
      lost: "os_failed",
    };
  }
  return undefined;
}
