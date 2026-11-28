import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";

// agent(lophn agent, harness)와 사람 token이 자기가 연 TUI 터미널 탭(`tab open --terminal`)과
// 사람이 넘겨준 터미널 탭(`tabs/hand`)을 보고 다루는 route 계약이다.
// 화면 글·제목·scrollback·highlights는 core에서 known-value redaction을 거치고 caller가 `<lophn-untrusted>`로 감싼다.

export const TUI_DEFAULT_COLS = 120;
export const TUI_DEFAULT_ROWS = 36;
export const TUI_MIN_COLS = 20;
export const TUI_MAX_COLS = 512;
export const TUI_MIN_ROWS = 5;
export const TUI_MAX_ROWS = 256;

export const TUI_SCROLLBACK_MAX = 500;
export const TUI_HIGHLIGHTS_MAX = 32;
export const TUI_SNAPSHOT_MAX_BYTES = 32_768;

export const TUI_WAIT_DEFAULT_MS = 10_000;
export const TUI_WAIT_MAX_MS = 25_000;
export const TUI_IDLE_DEFAULT_MS = 250;
export const TUI_IDLE_MIN_MS = 50;
export const TUI_IDLE_MAX_MS = 5_000;

export const TUI_TYPE_MAX = 4_096;
export const TUI_PASTE_MAX = 65_536;
export const TUI_KEYS_MAX = 64;
export const TUI_KEY_DELAY_MAX_MS = 500;
export const TUI_REGEX_MAX = 512;

export const TUI_MAX_PER_SESSION = 4;
export const TUI_MAX_GLOBAL = 16;

export const TERMINAL_PERSON_CONTROLLING_MESSAGE =
  "Person is controlling this terminal tab; wait for them to hand it back or ask them";

export const terminalModesSchema = z.strictObject({
  application_cursor_keys: z.boolean(),
  bracketed_paste: z.boolean(),
  alt_screen: z.boolean(),
  cursor_visible: z.boolean(),
  mouse_tracking: z.enum(["none", "x10", "normal", "button", "any"]),
  mouse_encoding: z.enum(["default", "utf8", "sgr", "urxvt", "sgr_pixel"]),
  kitty_keyboard_flags: z.number().int().min(0),
});
export type TerminalModes = z.infer<typeof terminalModesSchema>;

export const tuiCursorSchema = z.strictObject({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  visible: z.boolean(),
});
export type TuiCursor = z.infer<typeof tuiCursorSchema>;

export const tuiHighlightSchema = z.strictObject({
  row: z.number().int().min(0),
  col_start: z.number().int().min(0),
  col_end: z.number().int().min(0),
  text: z.string(),
});
export type TuiHighlight = z.infer<typeof tuiHighlightSchema>;

export const tuiStateSchema = z.enum([
  "starting",
  "running",
  "exited",
  "unknown",
]);
export type TuiState = z.infer<typeof tuiStateSchema>;

export const tuiReadOutputSchema = z.strictObject({
  tab: idSchema("tab"),
  generation: z.number().int().min(0),
  seq: z.number().int().min(0),
  state: tuiStateSchema,
  exit_code: z.number().int().nullable(),
  exit_signal: z.string().nullable(),
  columns: z.number().int().min(1),
  rows: z.number().int().min(1),
  title: z.string(),
  cursor: tuiCursorSchema,
  modes: terminalModesSchema,
  person_controlling: z.boolean(),
});
export type TuiReadOutput = z.infer<typeof tuiReadOutputSchema>;

export const tuiSnapshotSchema = z.strictObject({
  tab: idSchema("tab"),
  generation: z.number().int().min(0),
  seq: z.number().int().min(0),
  state: tuiStateSchema,
  exit_code: z.number().int().nullable(),
  exit_signal: z.string().nullable(),
  columns: z.number().int().min(1),
  rows: z.number().int().min(1),
  title: z.string(),
  cursor: tuiCursorSchema,
  modes: terminalModesSchema,
  screen: z.string(),
  scrollback: z.string().optional(),
  highlights: z.array(tuiHighlightSchema),
  truncated: z.boolean(),
  person_controlling: z.boolean(),
});
export type TuiSnapshot = z.infer<typeof tuiSnapshotSchema>;

export const tuiWaitResultSchema = z.strictObject({
  matched: z.boolean(),
  reason: z.enum(["matched", "idle", "exited", "timeout"]),
  elapsed_ms: z.number().int().min(0),
  snapshot: tuiSnapshotSchema,
});
export type TuiWaitResult = z.infer<typeof tuiWaitResultSchema>;

export const tuiActOutputSchema = z.strictObject({
  snapshot: tuiSnapshotSchema,
  wait: z
    .strictObject({
      matched: z.boolean(),
      reason: z.enum(["matched", "idle", "exited", "timeout"]),
      elapsed_ms: z.number().int().min(0),
    })
    .optional(),
});
export type TuiActOutput = z.infer<typeof tuiActOutputSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

const tabInput = { tab: idSchema("tab") };

// 화면 본문 없이 경량 상태(실행 상태, 종료 코드, 제목, 크기, 커서, 모드, 사람 제어 여부)만 읽는다.
export const terminalUseRead = defineMemory({
  resource: "terminal",
  method: "read",
  name: "TerminalRead",
  input: z.strictObject(tabInput),
  output: tuiReadOutputSchema,
  actors: ["agent", "user"],
  errors,
});

// 현재 viewport 평문 + 커서·모드·반전 구간(highlights)·선택 scrollback을 읽는다.
export const terminalUseSnapshot = defineMemory({
  resource: "terminal",
  method: "snapshot",
  name: "TerminalSnapshot",
  input: z.strictObject({
    ...tabInput,
    scrollback: z.number().int().min(0).max(TUI_SCROLLBACK_MAX).optional(),
    ansi: z.boolean().optional(),
  }),
  output: tuiSnapshotSchema,
  actors: ["agent", "user"],
  errors,
});

// 모드 인식 입력(type|paste|press|mouse)을 수행하고, 선택적 대기(--wait-idle / --wait-text) 뒤 최신 스냅샷을 돌려준다.
export const terminalUseAct = defineMemory({
  resource: "terminal",
  method: "act",
  name: "TerminalAct",
  changes: [],
  input: z.strictObject({
    ...tabInput,
    type: z.enum(["type", "paste", "press", "mouse"]),
    text: z.string().max(TUI_PASTE_MAX).optional(),
    keys: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(TUI_KEYS_MAX)
      .optional(),
    delay_ms: z.number().int().min(0).max(TUI_KEY_DELAY_MAX_MS).optional(),
    action: z
      .enum(["click", "down", "up", "move", "scroll_up", "scroll_down"])
      .optional(),
    col: z.number().int().optional(),
    row: z.number().int().optional(),
    button: z.enum(["left", "middle", "right"]).optional(),
    modifiers: z.array(z.enum(["shift", "alt", "ctrl"])).optional(),
    force: z.boolean().optional(),
    wait_idle: z
      .number()
      .int()
      .min(TUI_IDLE_MIN_MS)
      .max(TUI_IDLE_MAX_MS)
      .optional(),
    wait_text: z.string().min(1).max(1_000).optional(),
    timeout_ms: z.number().int().min(100).max(TUI_WAIT_MAX_MS).optional(),
  }),
  output: tuiActOutputSchema,
  actors: ["agent", "user"],
  errors,
});

// 이벤트 구동 조건 대기(text, regex, idle_ms, await_change, exit)와 최신 스냅샷을 돌려준다.
export const terminalUseWait = defineMemory({
  resource: "terminal",
  method: "wait",
  name: "TerminalWait",
  input: z.strictObject({
    ...tabInput,
    text: z.string().min(1).max(1_000).optional(),
    regex: z.string().min(1).max(TUI_REGEX_MAX).optional(),
    idle_ms: z
      .number()
      .int()
      .min(TUI_IDLE_MIN_MS)
      .max(TUI_IDLE_MAX_MS)
      .optional(),
    await_change: z.boolean().optional(),
    exit: z.boolean().optional(),
    timeout_ms: z.number().int().min(100).max(TUI_WAIT_MAX_MS).optional(),
  }),
  output: tuiWaitResultSchema,
  actors: ["agent", "user"],
  errors,
});

// PTY와 headless VT 에뮬레이터 크기를 함께 바꾼다.
export const terminalUseResize = defineMemory({
  resource: "terminal",
  method: "resize",
  name: "TerminalResize",
  changes: [],
  input: z.strictObject({
    ...tabInput,
    columns: z.number().int().min(TUI_MIN_COLS).max(TUI_MAX_COLS),
    rows: z.number().int().min(TUI_MIN_ROWS).max(TUI_MAX_ROWS),
  }),
  output: z.strictObject({
    tab: idSchema("tab"),
    generation: z.number().int().min(0),
    columns: z.number().int().min(1),
    rows: z.number().int().min(1),
  }),
  actors: ["agent", "user"],
  errors,
});

export const TERMINAL_USE_ROUTES = [
  terminalUseRead,
  terminalUseSnapshot,
  terminalUseAct,
  terminalUseWait,
  terminalUseResize,
] as const;
