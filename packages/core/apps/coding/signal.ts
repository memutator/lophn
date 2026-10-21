// main thread가 writer Worker에 넘기는 일의 이름과 모양. hook, 터미널 결과, Reactor, 메시지, 감지 보고처럼
// 메모리 route나 Reactor가 받은 일은 모두 이 command 하나로 writer 안에서 처리한다. session 상태가 writer
// Worker 쪽 ledger 표에 있고, 상태를 고치는 일은 정산·call 닫기와 같은 tx여야 하기 때문이다.
import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import { jsonValueSchema } from "../../../protocol/base/json-values.ts";
import { defineCommand } from "../../../protocol/base/mod.ts";
import {
  codingOptionsSchema,
} from "../../../protocol/coding-agent/harness-id.ts";
import {
  harnessDetectionSchema,
  harnessIdSchema,
} from "../../../protocol/coding-agent/harnesses.ts";
import { HOOK_EVENT_MAX_CHARS } from "../../../protocol/coding-agent/hook.ts";
import { requestIdSchema } from "../../../protocol/coding-agent/terminal-requests.ts";
import { ticketIdSchema } from "../../../protocol/coding-agent/ticket/values.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { createCallStore } from "../../router/mod.ts";
import { closeCall, CODING_REACTION_TEXTS } from "./close-call.ts";
import { applyHook } from "./hook.ts";
import { detectionsByHarness } from "./harnesses.ts";
import type { CodingMemory } from "./memory.ts";
import { applyMessage } from "./message.ts";
import { recoverCoding } from "./recover.ts";
import { loadSession } from "./store.ts";
import { applyTerminalExited, applyTerminalResult } from "./terminal.ts";

const session = idSchema("ses");

const codingSignalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("hook"),
    session,
    harness: harnessIdSchema,
    event: z.string().min(1).max(HOOK_EVENT_MAX_CHARS),
    payload: jsonValueSchema,
  }),
  z.strictObject({
    kind: z.literal("message"),
    session,
    body: z.string().min(1),
    tickets: z.array(ticketIdSchema),
  }),
  z.strictObject({
    kind: z.literal("terminal_result"),
    request: requestIdSchema,
    ok: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("terminal_exited"), session }),
  // 완료 보고, claim 만료, 보고 없는 끝. 셋 다 session을 가리킨다.
  z.strictObject({
    kind: z.literal("close_call"),
    event: z.enum(
      Object.keys(CODING_REACTION_TEXTS) as [
        keyof typeof CODING_REACTION_TEXTS,
      ],
    ),
    seq: z.string().min(1),
    session,
    ticket: ticketIdSchema,
    app: idSchema("app"),
  }),
  z.strictObject({
    kind: z.literal("harnesses"),
    detections: z.array(harnessDetectionSchema),
    defaults: codingOptionsSchema,
  }),
  z.strictObject({ kind: z.literal("recover") }),
]);
export type CodingSignal = z.infer<typeof codingSignalSchema>;

export const codingSignal = defineCommand({
  resource: "coding_agent_sessions",
  method: "signal",
  name: "ApplyCodingSignal",
  input: codingSignalSchema,
  output: z.object({ accepted: z.boolean() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable", "internal"],
});

type SignalResult = Result<{ accepted: boolean }>;

const accepted = (): SignalResult => ok({ accepted: true });

// 끝난 session의 행이 없으면(켠 뒤 정리됨) session을 받는 쪽으로 가리킨 call을 찾는다.
function closeByReceiver(
  tx: Tx,
  signal: Extract<CodingSignal, { kind: "close_call" }>,
): Result<void> {
  for (
    const call of createCallStore().openReceivedBy(tx, signal.session as never)
  ) {
    const closed = closeCall(tx, { ...signal, call: call.call });
    if (!closed.ok) return closed;
  }
  return ok(undefined);
}

function applySignal(
  tx: Tx,
  memory: CodingMemory,
  signal: CodingSignal,
): SignalResult {
  switch (signal.kind) {
    case "hook": {
      return applyHook(tx, memory, signal);
    }
    case "message": {
      const sent = applyMessage(tx, signal);
      return sent.ok ? accepted() : sent;
    }
    case "terminal_result": {
      const done = applyTerminalResult(tx, memory, signal);
      return done.ok ? accepted() : done;
    }
    case "terminal_exited": {
      const done = applyTerminalExited(tx, memory, signal.session);
      return done.ok ? accepted() : done;
    }
    case "close_call": {
      const row = loadSession(tx.sql, signal.session);
      const closed = row === null
        ? closeByReceiver(tx, signal)
        : closeCall(tx, { ...signal, call: row.call });
      return closed.ok ? accepted() : closed;
    }
    case "harnesses":
      memory.detections = detectionsByHarness(signal.detections);
      memory.defaults = signal.defaults;
      return accepted();
    case "recover": {
      const recovered = recoverCoding(tx);
      return recovered.ok ? accepted() : recovered;
    }
  }
}

export function createSignalCommand(
  memory: CodingMemory,
): CommandDefinition<typeof codingSignal> {
  return {
    route: codingSignal,
    handle: (tx, _ctx, input) => applySignal(tx, memory, input),
  };
}
