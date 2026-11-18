import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";

// 폰이 컴퓨터 터미널의 raw 화면을 보는 route다. 보는 동안 core가 PTY host의 화면을 읽어 메모리에 최신 하나만 둔다(ledger 없음). 화면이 바뀌었다는 알림은 `TerminalScreenChanged`(내용 없이 seq만)이고
// 폰이 `snapshot`을 다시 읽는다. 보는 것은 coding session의 터미널(그 목록은 `coding_sessions/list`)과 폰이 연 터미널뿐이다.

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

// 터미널에 글을 친다. 이 principal이 입력을 허락받았을 때만이고(아니면 forbidden) 같은 key는 한 번만 친다.
export const terminalViewInput = defineMemory({
  resource: "terminal_view",
  method: "input",
  name: "TerminalViewInput",
  changes: [],
  input: z.strictObject({
    terminal: terminalSchema,
    text: z.string().min(1).max(8192),
    key: z.string().min(1).max(200),
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

// project의 폴더에서 shell만 도는 터미널을 컴퓨터에 새로 열고 그 터미널을 준다(`terminals/open`과 같은 길). 창이 없어도 열리고, 그
// project를 보이는 창이 있으면 탭으로 보인다. 같은 key는 한 번만 연다.
export const terminalViewOpen = defineMemory({
  resource: "terminal_view",
  method: "open",
  name: "TerminalViewOpen",
  changes: [],
  input: z.strictObject({
    project: idSchema("prj"),
    key: z.string().min(1).max(200),
  }),
  output: z.strictObject({ terminal: terminalSchema }),
  actors: ["user"],
  errors,
});

export const TERMINAL_VIEW_ROUTES = [
  terminalViewSnapshot,
  terminalViewWatch,
  terminalViewInput,
  terminalViewResize,
  terminalViewOpen,
] as const;
