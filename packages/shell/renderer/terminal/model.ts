// 터미널 탭이 그리는 상태의 순수 규칙. IPC 답을 화면 상태로 옮기고, 종료·거절을
// 서로 다른 문구로 나눈다. 성공이나 exit code를 추측하지 않는다.
import type {
  TerminalFailure,
  TerminalFolderChoice,
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
  /** 등록 폴더가 여럿이다. 고르기 전에는 시작하지 않는다. */
  | {
      readonly kind: "choose";
      readonly folders: readonly TerminalFolderChoice[];
    }
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
  if (reply.reason === "choose_folder") {
    return { kind: "choose", folders: reply.folders ?? [] };
  }
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
  /** 상한이나 단절로 빠진 출력이 있다. */
  readonly missing: boolean;
}

/**
 * snapshot 출력을 이어 붙인다. 이미 쓴 seq는 버리고, seq가 건너뛰었거나 host가
 * dropped를 표시하면 출력 일부 없음으로 본다. 다른 generation의 늦은 출력은 쓰지 않는다.
 */
export function acceptOutput(
  lastSeq: number,
  generation: number,
  output: readonly TerminalOutput[],
): OutputStep {
  const writes: string[] = [];
  let seq = lastSeq;
  let missing = false;
  for (const item of output) {
    if (item.generation !== generation || item.seq <= seq) continue;
    if (item.seq > seq + 1) missing = true;
    if (item.dropped_output) missing = true;
    writes.push(item.chunk);
    seq = item.seq;
  }
  return { writes, lastSeq: seq, missing };
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

// agent TUI가 제목 앞에 붙이는 상태 글리프: braille spinner, 반원 spinner, Claude의 ✳, ASCII `* `·`. `.
// spinner 한 프레임이 제목에 남아도(herdr #5358) 이름이 흔들리지 않게 앞에서 걷어 낸다.
const STATUS_PREFIX = /^(?:[\u2800-\u28FF\u25D0-\u25D3\u2733]\s*|[*.]\s+)+/;

/** 터미널 제목에서 앞의 상태 글리프를 뗀 이름. harness별 손질은 하지 않는다. */
export function stripStatusGlyphs(title: string): string {
  return title.replace(STATUS_PREFIX, "").trim();
}

/**
 * 탭에 보일 이름. 사람이 붙인 이름, 그다음 coding agent가 도는 동안의 터미널 제목(`agentTitle`,
 * agent가 없으면 null), 없으면 자동 이름이다. 일반 shell은 prompt가 제목을 계속 바꾸므로 제목을 쓰지 않는다.
 */
export function tabName({
  person,
  agentTitle,
  auto,
}: {
  person: string | null;
  agentTitle: string | null;
  auto: string;
}): string {
  if (person !== null) return person;
  const stripped = agentTitle === null ? "" : stripStatusGlyphs(agentTitle);
  return stripped.length > 0 ? stripped : auto;
}
