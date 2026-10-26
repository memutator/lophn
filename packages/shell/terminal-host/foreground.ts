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
// 인자 하나를 이보다 짧게 자르면 못 알아본다.
const MAX_ARGS = 6;
const MAX_ARG_CHARS = 32768;

export function foregroundOf(deps: ForegroundDeps): string[] | null {
  try {
    if (deps.platform === "win32") return null;
    if (deps.platform !== "linux") {
      const name = deps.processName();
      return name === "" ? null : [name];
    }
    // comm에 공백과 `)`가 들어갈 수 있어 마지막 `)` 뒤부터 센다. state가 3번째 칸이라 tpgid는 8번째다.
    const stat = deps.readFile(`/proc/${deps.pid}/stat`);
    const rest = stat.slice(stat.lastIndexOf(")") + 1).trim().split(" ");
    const tpgid = Number(rest[5]);
    if (!Number.isInteger(tpgid) || tpgid <= 0 || tpgid === deps.pid) {
      return null;
    }
    // cmdline은 인자마다 NUL로 끝나서 마지막 조각이 빈 문자열이다.
    const argv = deps.readFile(`/proc/${tpgid}/cmdline`).split("\0");
    argv.pop();
    if (argv[0] === undefined || argv[0] === "") return null;
    return argv.slice(0, MAX_ARGS).map((arg) => arg.slice(0, MAX_ARG_CHARS));
  } catch {
    return null;
  }
}
