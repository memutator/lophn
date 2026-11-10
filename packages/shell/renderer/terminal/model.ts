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

/** 탭이 기억하는 coding agent session 이름과 그 이름의 session id(hook이 알려 준 것, 모르면 null). */
export interface RememberedName {
  readonly title: string;
  readonly session: string | null;
}

/**
 * 터미널 탭에 보일 이름과 탭이 기억할 session 이름. 탭 줄, sidebar, 그려지지 않은 탭 모두 이 규칙 하나를 쓴다.
 *
 * 순서는 사람이 붙인 이름 > GUI view의 ACP session 제목 > harness가 hook으로 알린 session 이름 > agent TUI가 낸 터미널
 * 제목 > 기억한 이름 > 제품 이름뿐인 터미널 제목 > 자동 이름이다.
 *
 * 이름의 출처는 그때그때 사라진다: GUI 제목은 그 탭을 그린 동안만 있고, 터미널 제목은 TUI가 foreground일 때만 믿을 수 있고
 * (아니면 shell prompt의 것이다), 새로 뜬 TUI는 topic을 다시 내기 전까지 제품 이름("Claude Code")을 낸다. 그때마다 자동
 * 이름으로 떨어지지 않게, 한 번 얻은 이름을 같은 session인 동안 기억한다. hook이 다른 session id를 알리면(`/clear`, 새
 * session) 옛 이름은 버린다. agent가 없으면(일반 shell) 터미널 제목을 쓰지 않는다: prompt가 계속 바꾼다.
 */
export function terminalName(input: {
  person: string | null;
  /** GUI view가 알린 ACP session 제목. GUI를 그리는 동안만 있다. */
  guiTitle: string | null;
  /** 터미널 안의 coding agent. 없으면 null. */
  agent: {
    readonly session: string | null;
    /** hook이 알린 session 이름. */
    readonly name: string | null;
    /** agent TUI가 foreground일 때의 터미널 제목. 아니면 null. */
    readonly screenTitle: string | null;
    /** 제품 이름. 터미널 제목이 이것뿐이면 session 이름이 아니다. */
    readonly label: string;
  } | null;
  remembered: RememberedName | null;
  auto: string;
}): { title: string; remembered: RememberedName | null } {
  const { person, agent, remembered, auto } = input;
  const some = (text: string | null) =>
    text !== null && text.length > 0 ? text : null;
  const guiTitle = some(input.guiTitle);
  if (agent === null) {
    return { title: person ?? guiTitle ?? auto, remembered };
  }
  const same =
    remembered !== null &&
    (remembered.session === null ||
      agent.session === null ||
      remembered.session === agent.session);
  const screen = some(agent.screenTitle);
  const real =
    guiTitle ?? some(agent.name) ?? (screen !== agent.label ? screen : null);
  const kept = same ? remembered.title : null;
  const next: RememberedName | null =
    real !== null
      ? { title: real, session: agent.session }
      : kept !== null
        ? { title: kept, session: agent.session ?? remembered!.session }
        : null;
  return {
    title: person ?? real ?? kept ?? screen ?? auto,
    remembered:
      next !== null &&
      remembered !== null &&
      next.title === remembered.title &&
      next.session === remembered.session
        ? remembered
        : next,
  };
}

/**
 * GUI 화면이 쓰는 session id. 터미널 탭의 `trm_<ULID>`에서 만들어 toggle로 handle(`win_<ULID>`)이 바뀌어도 같고, 탭을
 * 오가도 쳐 둔 글이 남는다. ACP 입력이 session을 `ses_<ULID>`로 검사하므로 ULID만 옮긴다(`ses_trm_…`이면 main이 모든
 * 입력을 거절한다).
 */
export function guiSessionId(id: string): string {
  return `ses_${id.slice(id.indexOf("_") + 1)}`;
}
