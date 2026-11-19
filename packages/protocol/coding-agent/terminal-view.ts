import { z } from "zod";
import { defineMemory, defineRead } from "../base/route.ts";

// 기기(폰, 연결된 컴퓨터)가 이 기계 터미널의 raw 화면을 보는 route다. 보는 동안 core가 PTY host의 화면을 읽어 메모리에 최신 하나만 둔다(ledger 없음). 화면이 바뀌었다는 알림은 `TerminalScreenChanged`이고,
// 작은 변화면 바뀐 줄만 diff로 싣는다(`terminalScreenDiffSchema`). diff가 없거나 기기의 마지막 seq가 `base_seq`와 다르면 기기가 `snapshot`을 다시 읽는다. 그 기계의 어느 터미널이든 본다. 여는 것과 입력은 `terminals/open|input`(`coding-agent/terminals.ts`)이다.

// `#rrggbb`이거나 xterm 256색 palette 번호(`p0`~`p255`)다.
const terminalColorSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|p(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))$/);

// 같은 모양이 이어지는 글 한 토막이다. 없는 칸은 기본(색 없음, 꺼짐)이다.
const terminalRunSchema = z.strictObject({
  text: z.string(),
  fg: terminalColorSchema.optional(),
  bg: terminalColorSchema.optional(),
  bold: z.boolean().optional(),
  dim: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  inverse: z.boolean().optional(),
  // 두 칸을 차지하는 글자(CJK, emoji)의 토막이다.
  wide: z.boolean().optional(),
});

export const terminalLineSchema = z.strictObject({
  runs: z.array(terminalRunSchema),
  // 이 줄이 다음 줄로 이어진다(자동 줄바꿈). 폰이 줄을 다시 접을 때 쓴다.
  wrapped: z.boolean(),
});
export type TerminalLine = z.infer<typeof terminalLineSchema>;

// 바로 앞 화면(`base_seq`)에서 바뀐 viewport 줄과 커서다. 같은 generation·크기·scrollback에서만 만든다: 줄이 scrollback으로 밀려
// 나갔거나 크기가 바뀌면 diff로 말할 수 없어 보는 쪽이 `snapshot`을 읽는다.
export const terminalScreenDiffSchema = z.strictObject({
  generation: z.number().int().min(0),
  base_seq: z.number().int().min(0),
  cursor: z.strictObject({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    hidden: z.boolean(),
  }),
  lines: z.array(terminalLineSchema.extend({ row: z.number().int().min(0) })),
});
export type TerminalScreenDiff = z.infer<typeof terminalScreenDiffSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

// 터미널 탭 참조(`trm_…`)다.
const terminalSchema = z.string().min(1);

// 보는 중인 터미널의 지금 화면이다. 아직 화면이 오지 않았으면(watch 직후) `unavailable`이다.
// input은 부른 principal이 이 터미널에 칠 수 있는가다(폰이 입력 칸을 그릴지 정한다).
export const terminalViewSnapshot = defineRead({
  resource: "terminal_view",
  method: "snapshot",
  name: "TerminalViewSnapshot",
  input: z.strictObject({ terminal: terminalSchema }),
  output: z.strictObject({
    terminal: terminalSchema,
    generation: z.number().int().min(0),
    seq: z.number().int().min(0),
    columns: z.number().int().min(1),
    rows: z.number().int().min(1),
    cursor: z.strictObject({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      hidden: z.boolean(),
    }),
    scrollback: z.array(terminalLineSchema),
    lines: z.array(terminalLineSchema),
    input: z.boolean(),
  }),
  actors: ["user"],
  errors,
});

// 이 principal이 이 터미널을 본다(lease 30초). 폰이 10초마다 같은 호출로 갱신한다. 터미널마다 lease가 하나라도 있는 동안
// core가 그 화면을 읽는다. tail은 viewport 위 scrollback 줄 수다.
export const terminalViewWatch = defineMemory({
  resource: "terminal_view",
  method: "watch",
  name: "TerminalViewWatch",
  changes: [],
  input: z.strictObject({
    terminal: terminalSchema,
    on: z.boolean(),
    tail: z.number().int().min(0).max(500).optional(),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 이 principal이 보는(lease가 있는) 터미널의 PTY 크기를 폰 화면의 열과 줄 수로 잡는다. 마지막에 잡은 쪽이 이긴다: 컴퓨터에서 그 탭에
// focus가 오면 컴퓨터가 다시 잡고, 그 터미널의 lease가 모두 끝나면 컴퓨터의 탭이 자기 크기로 되돌린다. lease가 없으면 conflict다.
export const terminalViewResize = defineMemory({
  resource: "terminal_view",
  method: "resize",
  name: "TerminalViewResize",
  changes: [],
  input: z.strictObject({
    terminal: terminalSchema,
    columns: z.number().int().min(10).max(512),
    rows: z.number().int().min(4).max(256),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

/**
 * snapshot에 diff를 적용한 새 snapshot이다. 보는 쪽의 마지막 화면이 diff의 바로 앞 화면(같은 generation, `base_seq`)이 아니거나
 * 줄 번호가 화면 밖이면 null이고, 그때는 `snapshot`을 다시 읽는다.
 */
export function applyScreenDiff<
  S extends {
    generation: number;
    seq: number;
    lines: TerminalLine[];
    cursor: unknown;
  },
>(screen: S, seq: number, diff: TerminalScreenDiff): S | null {
  if (
    screen.generation !== diff.generation ||
    screen.seq !== diff.base_seq ||
    seq <= screen.seq ||
    diff.lines.some((one) => one.row >= screen.lines.length)
  ) {
    return null;
  }
  const lines = [...screen.lines];
  for (const { row, ...line } of diff.lines) lines[row] = line;
  return { ...screen, seq, cursor: diff.cursor, lines };
}

export const TERMINAL_VIEW_ROUTES = [
  terminalViewSnapshot,
  terminalViewWatch,
  terminalViewResize,
] as const;
