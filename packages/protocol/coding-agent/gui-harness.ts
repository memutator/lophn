// 터미널 탭의 `<harness> gui` 대상 harness와 handoff·목록·rewind 미리보기 모양이다.
// import가 없어 coding-agent와 acp 모두 순환 없이 쓴다.

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

/**
 * agent 정의의 `harness_config`가 harness를 띄울 때 넘기는 값. `model`은 catalog의 model id이고 `options`는 그 model의 축 값
 * (`effort` 등 axis id → value)이다. 둘 다 없으면 CLI 기본이다. adapter가 자기 wire로 옮기고 lophn은 값을 해석하지 않는다.
 */
export type HarnessLaunchConfig = {
  model?: string;
  options?: Record<string, string>;
};
