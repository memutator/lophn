import { z } from "zod";
import { defineCommand, defineMemory } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { extensionSettingKey } from "../extensions/manifest.ts";
import type { HarnessId } from "../coding-agent/harness-id.ts";
import { HARNESS_RUNTIMES, type HarnessRuntime } from "./agent-values.ts";
import { callFromOutputSchema, callReplySchema } from "./calls.ts";
import { placeOutputSchema } from "./places.ts";
import { turnOutcomeSchema } from "./turn-values.ts";

// shell main의 harness host가 core를 부르는 길이다. host는 사람 token(actor user)으로 부르고, memory route라서
// renderer의 호출 통로(allowlist)에는 없다. 모든 route는 설정 `extensions.harness.enabled`가 꺼져 있으면 `unavailable`이고,
// runtime이 harness인 session이 아니면 `forbidden`이다.
//
// 한 turn의 순서: Take(다음 입력을 본다) → StartTurn(입력을 꺼내 turn을 시작) → Record(메시지, 여러 번)
// → FinishTurn. TurnEnded는 turn마다 한 번이다. 재시작하면 끝나지 않은 turn은 interrupted(restarted)로 끝나
// FinishTurn은 `conflict`다.

export const HARNESS_SETTING_KEY = extensionSettingKey("harness");

// runtime 값 → `HARNESS_ADAPTERS`의 id(감지, hook, resume 인자 표).
export const HARNESS_ADAPTER_ID = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
} as const satisfies Record<HarnessRuntime, HarnessId>;

const harnessRuntimeSchema = z.enum(HARNESS_RUNTIMES);
const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

// host가 실행할 입력 하나. `prompt`는 harness에 넘길 글이다(입력함의 입력을 lophn이 쓰는 tag로 싼 것, 이미지 없음).
const takenInputSchema = z.strictObject({
  session: idSchema("ses"),
  agent: z.string().min(1),
  place: placeOutputSchema.nullable(),
  harness: harnessRuntimeSchema,
  // 이어 갈 harness의 session id. 첫 turn이면 null이다.
  external_session_id: z.string().min(1).nullable(),
  // StartTurn이 이 입력을 가리킨다.
  input_message: idSchema("msg"),
  kind: z.enum(["message", "call", "reply", "reaction", "notice", "step"]),
  from: callFromOutputSchema,
  call: idSchema("cal").nullable(),
  // kind가 call일 때 답 방식. result이면 turn 끝에 마지막 메시지가 답이 된다.
  reply: callReplySchema.nullable(),
  unattended: z.boolean(),
  prompt: z.string(),
});

// 입력함에서 시작할 수 있는 입력 하나를 꺼내지 않고 본다. 도는 turn이 없는 harness session 중 먼저 기다린 것이고
// 사람 메시지가 먼저다. 없으면 null이다.
export const harnessTake = defineMemory({
  resource: "harness",
  method: "take",
  name: "HarnessTake",
  input: z.strictObject({}),
  output: z.strictObject({ input: takenInputSchema.nullable() }),
  actors: ["user"],
  errors,
});

// Take가 준 입력(맨 앞이어야 한다)을 입력함에서 꺼내 turn을 시작한다. 그 session은 turn이 끝날 때까지 도는 중이다.
export const harnessStartTurn = defineMemory({
  resource: "harness",
  method: "start_turn",
  name: "HarnessStartTurn",
  input: z.strictObject({
    session: idSchema("ses"),
    input_message: idSchema("msg"),
  }),
  output: z.strictObject({ turn: idSchema("trn") }),
  actors: ["user"],
  errors,
});

// 도는 turn에서 harness가 낸 메시지를 남긴다. 글과 harness가 쓴 tool(`harness_tool`)만 받는다. gate·rewind 기록은 없다.
const recordPartSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({
    kind: z.literal("harness_tool"),
    name: z.string().min(1),
    summary: z.string(),
    status: z.enum(["running", "done", "failed"]),
  }),
]);
export const harnessRecord = defineMemory({
  resource: "harness",
  method: "record",
  name: "HarnessRecord",
  input: z.strictObject({
    session: idSchema("ses"),
    turn: idSchema("trn"),
    parts: z.array(recordPartSchema).min(1),
  }),
  output: z.strictObject({ message: idSchema("msg") }),
  actors: ["user"],
  errors,
});

// turn을 끝낸다. interrupted는 host가 고르지 못한다(멈춤과 재시작은 core가 닫는다). 끝난 turn이면 `conflict`다.
// outcome이 completed이고 입력이 answer를 기다리는 call(reply result)이며 harness가 먼저 reply하지 않았으면,
// 이 turn의 마지막 메시지가 그 call의 답으로 간다.
export const harnessFinishTurn = defineMemory({
  resource: "harness",
  method: "finish_turn",
  name: "HarnessFinishTurn",
  input: z.strictObject({
    turn: idSchema("trn"),
    outcome: turnOutcomeSchema.refine((value) => value.kind !== "interrupted", {
      message: "interrupts are closed by core",
    }),
  }),
  output: z.strictObject({ turn: idSchema("trn") }),
  actors: ["user"],
  errors,
});

// harness가 알려 준 session id를 lophn session에 둔다. 다음 turn의 Take가 `external_session_id`로 돌려준다.
export const harnessSetExternalId = defineMemory({
  resource: "harness",
  method: "set_external_id",
  name: "HarnessSetExternalId",
  input: z.strictObject({
    session: idSchema("ses"),
    external_session_id: z.string().min(1).max(256),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 위 memory route가 ledger에 쓰는 machine command다. 사람 token으로는 부를 수 없다.
export const bindHarnessSession = defineCommand({
  resource: "harness",
  method: "bind_session",
  name: "BindHarnessSession",
  input: z.strictObject({
    session: idSchema("ses"),
    external_session_id: z.string().min(1).max(256),
  }),
  output: z.strictObject({ state_seq: seqSchema }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const HARNESS_HOST_MEMORY_ROUTES = [
  harnessTake,
  harnessStartTurn,
  harnessRecord,
  harnessFinishTurn,
  harnessSetExternalId,
] as const;

export const HARNESS_HOST_ROUTES = [
  ...HARNESS_HOST_MEMORY_ROUTES,
  bindHarnessSession,
] as const;
