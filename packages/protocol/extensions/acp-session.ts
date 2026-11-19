// extension이 CLI session 하나를 ACP로 내고 그 화면의 입력을 받는 계약이다. 터미널 탭 하나가 handle 하나다.
// shell main tsc도 읽는 file이라(host-queue.ts → manifest.ts를 거쳐) schema(zod)는 두지 않고 type만 import한다.
import type { AcpInput } from "../acp/input.ts";
import type { AcpUpdate } from "../acp/state.ts";

/** 탭의 `<harness> gui`가 받는 harness. 이 목록은 여기 하나다. */
export const GUI_HARNESSES = [
  "claude",
  "codex",
  "opencode",
  "omp",
  "antigravity",
] as const;
export type GuiHarness = (typeof GUI_HARNESSES)[number];

export function isGuiHarness(value: unknown): value is GuiHarness {
  return (GUI_HARNESSES as readonly unknown[]).includes(value);
}

/**
 * TUI를 GUI로 넘기는 길. restart는 한쪽 process를 끄고 같은 session으로 다른 쪽을 띄우고, shared는 TUI와 GUI가 한 server에 같이
 * 붙는다. harness-gui adapter 표와 handle이 없는 터미널의 handoff(`coding_sessions/list`의 `handoff`)가 같이 이것을 쓴다.
 */
export const GUI_HANDOFF: Readonly<Record<GuiHarness, "restart" | "shared">> = {
  claude: "restart",
  omp: "restart",
  antigravity: "restart",
  codex: "shared",
  opencode: "shared",
};

/** 창 하나의 handle. `id`는 lophn session id가 아니라 이 창 하나의 id다. */
export type AcpSessionHandle = {
  readonly id: string;
  /** 창으로 보낸다. 창이 아직 없거나 늦게 열려도 쌓아 두었다가 처음부터 보여 준다. */
  publish(update: AcpUpdate): void;
  /** 창의 입력. */
  onInput(listener: (input: AcpInput) => void): void;
  /** 창이 닫히거나 `close()`가 불리면 한 번 불린다. */
  onClose(listener: () => void): void;
  /** 창을 닫는다. 두 번 불러도 같다. */
  close(): void;
};

/**
 * terminal 탭 하나의 PTY. harness-gui가 TUI와 GUI를 오갈 때 쓴다. `id`는 terminal_ref이고 `env`는 그 탭의 hook env다.
 * `state()`의 `shell`은 PTY foreground에 harness가 없다(shell prompt)는 뜻이고, 나머지는 foreground harness의
 * terminal-agent tracker 상태다.
 */
export type AcpTerminal = {
  readonly id: string;
  readonly cwd: string;
  readonly harness: GuiHarness;
  readonly env: Readonly<Record<string, string>>;
  state(): "shell" | "idle" | "running" | "waiting" | "unknown";
  /** foreground harness 자신의 session id. 모르면 null. */
  sessionId(): string | null;
  /** PTY에 글을 친다(사람이 친 것과 같다). 줄을 보내려면 `\r`을 붙인다. */
  type(text: string): void;
  signal(signal: "SIGINT" | "SIGTERM"): void;
  /** foreground process가 끝나면 불린다(shell prompt로 돌아왔다). 돌려받은 함수로 그만 듣는다. */
  onForegroundExit(listener: () => void): () => void;
  /**
   * 그림 bytes를 이 탭의 임시 폴더에 쓰고 절대 경로를 준다(사람이 붙인 그림과 같은 자리). 지난 대화의 그림을 다시 그릴 때
   * 메시지에 그 경로의 `file://` resource_link를 싣는다. PNG·JPEG·GIF·WebP가 아니거나 못 쓰면 null이다.
   */
  writeImage(image: { name: string; data: Uint8Array }): Promise<string | null>;
};

/** `onTab`의 `gui`가 받는 것. 탭이 GUI로 가야 한다. `resume`은 그 CLI 자신의 session id. */
export type AcpTabRequest = {
  terminal: AcpTerminal;
  harness: GuiHarness;
  resume?: string;
  /** TUI가 `--dangerously-skip-permissions`로 돌고 있었으면 GUI에도 같은 flag를 이어 간다(antigravity). */
  skipPermissions?: boolean;
};

/** 그 CLI가 이 폴더에서 가진 지난 session 하나(`open_session`의 `cli_session`이 `id`다). */
export type AcpCliSession = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

/** 그 사람 메시지로 rewind하면 되돌아갈 file. `change`는 `file_change` subject와 같은 값이다. */
export type AcpRewindPreview = {
  files: { path: string; change: "create" | "update" | "delete" }[];
};

/** terminal 탭에 묶인 handle을 여는 값. 그 탭에 GUI가 붙는다. */
export type AcpOpenTab = {
  terminal: AcpTerminal;
  harness: GuiHarness;
  title: string;
  /** adapter의 `handoff`. 탭의 modal과 toggle이 어느 길인지 안다. */
  handoff: "restart" | "shared";
};

/** 탭의 GUI·TUI 전환을 받는 쪽. 켜진 harness-gui가 `onTab`으로 건다. */
export type AcpTabHandlers = {
  gui(request: AcpTabRequest): void | Promise<void>;
  tui(terminalId: string): void | Promise<void>;
  /** 그 탭의 run이 도는 일(restart 전 modal이 "멈출 것"으로 보인다). run이 없으면 null. */
  running(terminalId: string): { turn: boolean; tasks: number } | null;
  /** 그 CLI가 이 폴더에서 가진 지난 session, 최근 순. run이 없거나 못 주면 빈 배열. */
  sessions(terminalId: string): Promise<AcpCliSession[]>;
  /** 그 사람 메시지로 rewind하면 되돌아갈 file. run이 없거나 못 주면 null. */
  rewindPreview(
    terminalId: string,
    message: string,
  ): Promise<AcpRewindPreview | null>;
};

export type ExtensionAcp = {
  open(options: AcpOpenTab): AcpSessionHandle;
  /**
   * terminal 탭의 GUI·TUI 전환을 받을 함수. `gui`는 탭을 GUI로 바꾸라는 요청이고 `tui`는 GUI에서 TUI로 돌아가라는
   * 요청(terminal id)이다. 켜진 extension 하나가 `activate`에서 걸고 돌려받은 함수로 `deactivate`에서 푼다.
   */
  onTab(handlers: AcpTabHandlers): () => void;
};
