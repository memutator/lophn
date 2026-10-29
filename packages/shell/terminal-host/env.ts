// OS 사용자 환경에서 플랫폼이 만든 token·connection·handle·내부 endpoint를 뺀다.
// 일반 shell에는 플랫폼 credential을 넣지 않는다.

const SECRET_NAME =
  /(TOKEN|SECRET|PASSWORD|CREDENTIAL|KEYCHAIN|HANDLE|API_KEY|AUTH)/i;
const INTERNAL_NAME = /^(LOPHN_|ELECTRON_|NODE_CHANNEL_FD$)/;
// 터미널을 연 process가 agent session 안에서 도는 중이면 그 session이 자식 env에 넣은 표지다. 새 터미널은
// 사람의 것이라 물려받지 않는다(Claude Code는 CLAUDE_CODE_CHILD_SESSION이 있으면 transcript를 저장하지
// 않는다). 이름은 각 CLI가 자식 process env에 넣는 목록이다. CLAUDE_CODE_USE_BEDROCK 같은 사용자 설정은
// 지우지 않는다.
const SESSION_MARKER_NAME = new Set([
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CODEX_THREAD_ID",
  "CODEX_TOOL_CALL_ID",
  "CODEX_VERSION",
  "CODEX_PERMISSION_PROFILE",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
]);
const INTERNAL_VALUE = /lophn-(core|agent|shell):\/\/|127\.0\.0\.1:\d{2,5}/i;

export function stripPlatformEnv(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (INTERNAL_NAME.test(name)) continue;
    if (SESSION_MARKER_NAME.has(name)) continue;
    if (SECRET_NAME.test(name)) continue;
    if (INTERNAL_VALUE.test(value)) continue;
    out[name] = value;
  }
  return out;
}

/**
 * 터미널 shell이 받는 env. 터미널 능력은 lophn을 띄운 process에서 물려받지 않고 lophn이 정한다. xterm은
 * truecolor를 그리지만 TERM(xterm-256color)만으로는 program이 모른다. Claude Code(chalk)·Codex는 COLORTERM이
 * 없으면 256색으로 내려 자기 색을 근사한다. lophn을 COLORTERM 없는 곳(launcher, agent)에서 띄우면 그렇게 됐다.
 */
export function terminalEnv(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return { ...stripPlatformEnv(source), COLORTERM: "truecolor" };
}

type ShellProgram = {
  file: string;
  args: string[];
  label: string;
};

type ShellLookup = {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  exists: (file: string) => boolean;
};

const POWERSHELL7 = ["pwsh.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"];
const POWERSHELL51 = [
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
];

/** Linux·macOS는 login shell, Windows는 PowerShell 7, 없으면 표시한 5.1. */
export function resolveLoginShell(lookup: ShellLookup): ShellProgram | null {
  if (lookup.platform === "win32") {
    for (const file of POWERSHELL7) {
      if (lookup.exists(file)) {
        return { file, args: ["-NoLogo"], label: "PowerShell 7" };
      }
    }
    for (const file of POWERSHELL51) {
      if (lookup.exists(file)) {
        return { file, args: ["-NoLogo"], label: "PowerShell 5.1" };
      }
    }
    return null;
  }
  const shell = lookup.env.SHELL;
  if (!shell || shell.includes("\0") || !lookup.exists(shell)) return null;
  return { file: shell, args: ["-l"], label: shell };
}
