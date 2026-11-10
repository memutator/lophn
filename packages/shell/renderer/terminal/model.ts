// 터미널 탭이 그리는 상태의 순수 규칙. IPC 답을 화면 상태로 옮기고, 종료·거절을
// 서로 다른 문구로 나눈다. 성공이나 exit code를 추측하지 않는다.
import type {
  TerminalFailure,
  TerminalOutput,
  TerminalReply,
  TerminalRuntime,
} from "../../ipc/terminal.ts";

/** 시작하지 않고 멈춘 이유. 다른 폴더로 대신 시작하지 않는다. */
export type Refusal =
  | "no_folder"
  | "not_directory"
  | "unreadable"
  | "spawn_failed"
  | "unavailable";

/** 끝난 모양. 확인된 종료·시작 실패·결과 불명·종료 확인 실패는 서로 다르다. */
export type Ending = "exited" | "start_failed" | "unknown" | "stop_unconfirmed";

export type Phase =
  /** 사람이 열었고 main의 답을 기다린다. */
  | { readonly kind: "opening" }
  | { readonly kind: "refused"; readonly reason: Refusal }
  | { readonly kind: "live"; readonly runtime: TerminalRuntime }
  | {
      readonly kind: "ended";
      readonly ending: Ending;
      readonly runtime: TerminalRuntime | null;
    }
  /**
   * 복원한 탭이거나 runtime을 다시 찾지 못했다. 사람이 누르기 전에는 PTY를
   * 만들지 않는다.
   */
  | { readonly kind: "idle" };

/** runtime 상태가 끝났으면 그 모양을, 살아 있으면 null을 준다. */
export function endingOf(runtime: TerminalRuntime): Ending | null {
  if (runtime.state === "running" || runtime.state === "starting") return null;
  if (runtime.state === "exited") {
    return runtime.failure_reason === "spawn_failed"
      ? "start_failed"
      : "exited";
  }
  return runtime.failure_reason === "kill_unconfirmed"
    ? "stop_unconfirmed"
    : "unknown";
}

/** runtime을 화면 상태로 옮긴다. */
export function phaseOfRuntime(runtime: TerminalRuntime): Phase {
  const ending = endingOf(runtime);
  return ending === null
    ? { kind: "live", runtime }
    : { kind: "ended", ending, runtime };
}

function refusalOf(reason: TerminalFailure): Refusal {
  switch (reason) {
    case "no_folder":
    case "not_directory":
    case "unreadable":
    case "spawn_failed":
      return reason;
    default:
      return "unavailable";
  }
}

/** open·restart 답을 화면 상태로 옮긴다. */
export function phaseOfReply(reply: TerminalReply): Phase {
  if (reply.ok) return phaseOfRuntime(reply.runtime);
  return { kind: "refused", reason: refusalOf(reply.reason) };
}

type StatusTone = "neutral" | "warning" | "serious" | "critical";

type EndingWording =
  | { key: "terminal.status.exited"; values: { code: string } }
  | {
      key:
        | "terminal.status.ended"
        | "terminal.status.start-failed"
        | "terminal.status.unknown"
        | "terminal.status.stop-unconfirmed";
      values?: undefined;
    };

/** 끝난 모양의 문구와 색조. exit code는 확인된 값만 보인다. */
export function endingWording(
  ending: Ending,
  exitCode: number | null,
): { wording: EndingWording; tone: StatusTone } {
  switch (ending) {
    case "exited":
      return exitCode === null
        ? { wording: { key: "terminal.status.ended" }, tone: "neutral" }
        : {
            wording: {
              key: "terminal.status.exited",
              values: { code: String(exitCode) },
            },
            tone: exitCode === 0 ? "neutral" : "warning",
          };
    case "start_failed":
      return {
        wording: { key: "terminal.status.start-failed" },
        tone: "critical",
      };
    case "unknown":
      return { wording: { key: "terminal.status.unknown" }, tone: "serious" };
    case "stop_unconfirmed":
      return {
        wording: { key: "terminal.status.stop-unconfirmed" },
        tone: "serious",
      };
  }
}

export const REFUSAL_KEY: Record<
  Refusal,
  | "terminal.error.no-folder"
  | "terminal.error.not-directory"
  | "terminal.error.unreadable"
  | "terminal.error.spawn-failed"
  | "terminal.error.unavailable"
> = {
  no_folder: "terminal.error.no-folder",
  not_directory: "terminal.error.not-directory",
  unreadable: "terminal.error.unreadable",
  spawn_failed: "terminal.error.spawn-failed",
  unavailable: "terminal.error.unavailable",
};

interface OutputStep {
  /** xterm에 이 순서대로 쓴다. */
  readonly writes: readonly string[];
  /** 다음 snapshot의 after_seq. */
  readonly lastSeq: number;
}

/**
 * snapshot과 push가 겹친 출력을 한 번만 쓴다. 다른 generation의 늦은 출력은 쓰지 않는다.
 */
export function acceptOutput(
  lastSeq: number,
  generation: number,
  output: readonly TerminalOutput[],
): OutputStep {
  const writes: string[] = [];
  let seq = lastSeq;
  for (const item of output) {
    if (item.generation !== generation || item.seq <= seq) continue;
    writes.push(item.chunk);
    seq = item.seq;
  }
  return { writes, lastSeq: seq };
}

/** 붙여넣기 같은 큰 입력을 IPC 상한(8192자) 안으로 자른다. 순서는 유지한다. */
export function splitInput(text: string, limit = 8192): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = limit;
    // surrogate pair를 가르지 않는다.
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** 탭 제목. 시작 폴더의 마지막 이름이고, 모르면 null이다. */
export function folderTitle(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).pop() ?? "";
  return name.length > 0 ? name : null;
}

/**
 * 탭에 보일 이름. 사람이 붙인 이름, GUI view의 ACP session 제목(`guiTitle`, GUI가 아니면 null), harness가 hook으로
 * 알린 session 이름(`sessionName`), 그다음 coding agent가 도는 동안의 터미널 제목(`agentTitle`, agent가 없으면 null.
 * main이 PTY 출력에서 읽어 상태 글리프를 뗀 값이다), 없으면 자동 이름이다. GUI 동안의 터미널 제목은 TUI가 끝난 뒤 shell prompt가 낸 것이라 쓰지 않는다. 일반 shell은
 * prompt가 제목을 계속 바꾸므로 제목을 쓰지 않는다.
 */
export function tabName({
  person,
  guiTitle,
  sessionName,
  agentTitle,
  auto,
}: {
  person: string | null;
  guiTitle: string | null;
  sessionName: string | null;
  agentTitle: string | null;
  auto: string;
}): string {
  if (person !== null) return person;
  if (guiTitle !== null && guiTitle.length > 0) return guiTitle;
  if (sessionName !== null && sessionName.length > 0) return sessionName;
  return agentTitle !== null && agentTitle.length > 0 ? agentTitle : auto;
}

/**
 * GUI 화면이 쓰는 session id. 터미널 탭의 `trm_<ULID>`에서 만들어 toggle로 handle(`win_<ULID>`)이 바뀌어도 같고, 탭을
 * 오가도 쳐 둔 글이 남는다. ACP 입력이 session을 `ses_<ULID>`로 검사하므로 ULID만 옮긴다(`ses_trm_…`이면 main이 모든
 * 입력을 거절한다).
 */
export function guiSessionId(id: string): string {
  return `ses_${id.slice(id.indexOf("_") + 1)}`;
}
