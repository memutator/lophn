// core가 shell main에 Gateway frame으로 보내는 터미널 요청과, shell main이 core에 알리는 결과.
// shell main은 사람 token으로 접속한 하나뿐인 client다. `open` 요청의 plan.env에 coding token이
// 있으므로 shell main은 이 frame을 renderer로 중계하지 않는다.
import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { codingLaunchPlanSchema } from "./launch-plan.ts";
import { codingSessionIdSchema } from "./token.ts";

// 요청 하나를 가리키는 값이다. 결과는 같은 값으로 돌아온다.
export const requestIdSchema = z.string().min(1).max(80);

export const TERMINAL_INPUT_MAX_CHARS = 8192;

// `open`은 새 탭을 열되 focus를 옮기지 않는다. `input`은 사람이 그 탭에 focus해 있으면 shell main이
// focus가 풀릴 때까지 쥐고 있다가 넣은 뒤 `result`로 알린다. `stop`은 cancel·ticket 취소·lophn 끄기 때 쓴다.
export const codingTerminalRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("open"),
    request: requestIdSchema,
    plan: codingLaunchPlanSchema,
  }),
  z.strictObject({
    kind: z.literal("input"),
    request: requestIdSchema,
    session: codingSessionIdSchema,
    text: z.string().max(TERMINAL_INPUT_MAX_CHARS),
  }),
  z.strictObject({
    kind: z.literal("stop"),
    request: requestIdSchema,
    session: codingSessionIdSchema,
  }),
]);
export type CodingTerminalRequest = z.infer<typeof codingTerminalRequestSchema>;

export const codingTerminalFrameSchema = z.strictObject({
  type: z.literal("coding_terminal"),
  request: codingTerminalRequestSchema,
});
export type CodingTerminalFrame = z.infer<typeof codingTerminalFrameSchema>;

export const TERMINAL_FAILURES = [
  "spawn_failed",
  "no_terminal",
  "folder_missing",
  "host_lost",
] as const;
export const terminalFailureSchema = z.enum(TERMINAL_FAILURES);

// 요청 하나의 결과다.
export const codingTerminalResult = defineMemory({
  resource: "coding_agent_terminals",
  method: "result",
  name: "coding.terminal_result",
  input: z.discriminatedUnion("ok", [
    z.strictObject({
      request: requestIdSchema,
      ok: z.literal(true),
      terminal_ref: z.string().min(1).optional(),
    }),
    z.strictObject({
      request: requestIdSchema,
      ok: z.literal(false),
      reason: terminalFailureSchema,
    }),
  ]),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

// 그 session의 터미널 process가 끝났다.
export const codingTerminalExited = defineMemory({
  resource: "coding_agent_terminals",
  method: "exited",
  name: "coding.terminal_exited",
  input: z.strictObject({
    session: codingSessionIdSchema,
    exit_code: z.number().int().nullable(),
    reason: z.enum(["exited", "killed", "host_lost"]),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

export const TERMINAL_ROUTES = [
  codingTerminalResult,
  codingTerminalExited,
] as const;
