// OS 사용자 환경에서 플랫폼이 만든 token·connection·handle·내부 endpoint를 뺀다.
// 일반 shell에는 플랫폼 credential을 넣지 않는다.

const SECRET_NAME =
  /(TOKEN|SECRET|PASSWORD|CREDENTIAL|KEYCHAIN|HANDLE|API_KEY|AUTH)/i;
const INTERNAL_NAME = /^(LOPHN_|ELECTRON_|NODE_CHANNEL_FD$)/;
const INTERNAL_VALUE = /lophn-(core|agent|shell):\/\/|127\.0\.0\.1:\d{2,5}/i;

export function stripPlatformEnv(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (INTERNAL_NAME.test(name)) continue;
    if (SECRET_NAME.test(name)) continue;
    if (INTERNAL_VALUE.test(value)) continue;
    out[name] = value;
  }
  return out;
}

export type ShellProgram = {
  file: string;
  args: string[];
  label: string;
};

export type ShellLookup = {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  exists: (file: string) => boolean;
};

const POWERSHELL7 = [
  "pwsh.exe",
  "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
];
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
