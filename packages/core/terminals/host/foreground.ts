// PTY의 foreground process argv다. 어느 harness TUI가 도는지 화면이 아니라 process로 안다.
// 읽지 못하면 null이다(모르는 것이지 없는 것이 아니다). 어느 harness인지 고르는 일은 protocol의
// `harnessOfProcess`가 하고 여기는 읽기만 한다.

export type ForegroundDeps = {
  /** shell(PTY child)의 pid. */
  pid: number;
  platform: NodeJS.Platform;
  /** node-pty `IPty.process`. 비 Linux POSIX는 이 이름만 쓴다. */
  processName(): string;
  /** 동기 file read. 없거나 못 읽으면 throw한다. */
  readFile(path: string): string;
};

// Hermes는 `python3 -I -c '<launcher code>'`로 돌고 표지(`hermes_cli.main`)가 7KB 가까운 code의 끝에 있다.
// 인자 하나를 이보다 짧게 자르면 못 알아본다. resume flag나 `--dangerously-skip-permissions`가 앞 인자 뒤에 올 수 있어 넉넉히 읽는다.
const MAX_ARGS = 32;
const MAX_ARG_CHARS = 32768;

/**
 * Linux에서 PTY foreground process group의 id(tpgid). foreground가 shell 자신이거나 읽지 못하면 null이다.
 * 비 Linux는 읽는 길이 없어 null이다(signal을 보낼 수 없다).
 */
export function foregroundGroupOf(
  deps: Pick<ForegroundDeps, "pid" | "platform" | "readFile">,
): number | null {
  try {
    if (deps.platform !== "linux") return null;
    // comm에 공백과 `)`가 들어갈 수 있어 마지막 `)` 뒤부터 센다. state가 3번째 칸이라 tpgid는 8번째다.
    const stat = deps.readFile(`/proc/${deps.pid}/stat`);
    const rest = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(" ");
    const tpgid = Number(rest[5]);
    return !Number.isInteger(tpgid) || tpgid <= 0 || tpgid === deps.pid
      ? null
      : tpgid;
  } catch {
    return null;
  }
}

export function foregroundOf(deps: ForegroundDeps): string[] | null {
  try {
    if (deps.platform === "win32") return null;
    if (deps.platform !== "linux") {
      const name = deps.processName();
      return name === "" ? null : [name];
    }
    const tpgid = foregroundGroupOf(deps);
    if (tpgid === null) return null;
    // cmdline은 인자마다 NUL로 끝나서 마지막 조각이 빈 문자열이다.
    const argv = deps.readFile(`/proc/${tpgid}/cmdline`).split("\0");
    argv.pop();
    if (argv[0] === undefined || argv[0] === "") return null;
    return argv.slice(0, MAX_ARGS).map((arg) => arg.slice(0, MAX_ARG_CHARS));
  } catch {
    return null;
  }
}

export type WinDescendant = {
  pid: number;
  ppid: number;
  name: string;
  commandLine: string | null;
};

// Windows CommandLineToArgvW 규칙으로 command line을 argv로 나눈다.
export function parseWindowsCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  let i = 0;
  const n = commandLine.length;
  while (i < n && args.length < MAX_ARGS) {
    while (i < n && (commandLine[i] === " " || commandLine[i] === "\t")) i++;
    if (i >= n) break;
    let current = "";
    let inQuotes = false;
    while (i < n) {
      const ch = commandLine[i]!;
      if (ch === "\\") {
        let slashes = 0;
        while (i < n && commandLine[i] === "\\") {
          slashes++;
          i++;
        }
        if (i < n && commandLine[i] === '"') {
          current += "\\".repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
            i++;
          }
        } else {
          current += "\\".repeat(slashes);
        }
      } else if (ch === '"') {
        if (inQuotes && i + 1 < n && commandLine[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = !inQuotes;
          i++;
        }
      } else if ((ch === " " || ch === "\t") && !inQuotes) {
        break;
      } else {
        current += ch;
        i++;
      }
    }
    args.push(current.slice(0, MAX_ARG_CHARS));
  }
  return args;
}

// Windows PTY shell의 자손 process 목록(BFS 순)에서 가장 얕은 coding agent harness의 argv를 고른다.
// claude.exe 아래에 bash.exe·node.exe가 떠도 얕은 claude.exe가 먼저 잡히고, cmd.exe → node.exe <qwen>은
// cmd.exe를 건너뛰고 node.exe를 잡는다. harness가 없으면 null이다.
export function selectWinForeground(
  descendants: readonly WinDescendant[],
  isHarness: (argv: readonly string[]) => boolean,
): string[] | null {
  for (const proc of descendants) {
    const raw =
      proc.commandLine !== null && proc.commandLine.trim() !== ""
        ? parseWindowsCommandLine(proc.commandLine)
        : proc.name !== ""
          ? [proc.name]
          : [];
    if (raw.length === 0) continue;
    if (isHarness(raw)) return raw;
  }
  return null;
}
