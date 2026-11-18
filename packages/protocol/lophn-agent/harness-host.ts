import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory } from "../base/route.ts";
import { seqSchema } from "../base/values.ts";
import { extensionSettingKey } from "../extensions/manifest.ts";
import { HARNESS_RUNTIMES } from "./agent-values.ts";
import { callFromOutputSchema, callReplySchema } from "./calls.ts";
import { workspaceOutputSchema } from "./workspaces.ts";
import { turnOutcomeSchema } from "./turn-values.ts";

// core 안 extension host에서 도는 harness extension이 core를 부르는 길이다. host는 사람 권한의 core 안 자격(actor user)으로 부르고, memory route라서
// renderer의 호출 통로(allowlist)에는 없다. Take와 StartTurn은 설정 `extensions.harness.enabled`가 꺼져 있으면 `unavailable`이다.
// 나머지(Record, FinishTurn, SetExternalId)는 꺼져 있어도 일해서, 꺼질 때 돌던 turn이 끝날 수 있다.
// 모든 route는 runtime이 harness인 session이 아니면 `forbidden`이다.
//
// core가 resume으로 연 터미널의 session(`tabs/open`의 tui, `coding_sessions/open`의 resume)은 그 CLI session에 process 둘이 쓰지
// 않게 hold된다. Take는 hold된 session의 입력을 건너뛰고 StartTurn은 `conflict`다. hold는 임대이고 core가 그 터미널이 도는 동안
// (TUI는 그 harness가 foreground에 보였다 떠날 때까지) 갱신한다.
//
// 한 turn의 순서: Take(다음 입력을 본다) → StartTurn(입력을 꺼내 turn을 시작) → Record(메시지, 여러 번)
// → FinishTurn. TurnEnded는 turn마다 한 번이다. 재시작하면 끝나지 않은 turn은 interrupted(restarted)로 끝나
// FinishTurn은 `conflict`다.

export const HARNESS_SETTING_KEY = extensionSettingKey("harness");

const harnessRuntimeSchema = z.enum(HARNESS_RUNTIMES);
const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

// host가 실행할 입력 하나. `prompt`는 harness에 넘길 글이다(queue의 입력을 lophn이 쓰는 tag로 싼 것, 이미지 없음).
const takenInputSchema = z.strictObject({
  session: idSchema("ses"),
  agent: z.string().min(1),
  workspace: workspaceOutputSchema.nullable(),
  harness: harnessRuntimeSchema,
  // 이어 갈 harness의 session id. 첫 turn이면 null이다.
  external_session_id: z.string().min(1).nullable(),
  // external_session_id가 null이고 이 session이 harness 원본의 끝에서 fork되었으면 원본의 harness session id다.
  // fork를 지원하는 harness는 그것에서 갈라 시작해 앞 대화를 물려받고, 나머지는 새로 시작한다.
  fork_external_session_id: z.string().min(1).nullable(),
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

// queue에서 시작할 수 있는 입력 하나를 꺼내지 않고 본다. 도는 turn이 없고 TUI로 열려 있지 않은 harness session 중 먼저 기다린 것이고
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

// Take가 준 입력(맨 앞이어야 한다)을 queue에서 꺼내 turn을 시작한다. 그 session은 turn이 끝날 때까지 도는 중이다.
// `credential`은 harness가 자기 shell에서 `lophn`을 부를 agent 자격이다. 이 session·turn에만 쓰이고 turn이 끝나면 만료된다.
// host는 harness process의 env로만 넘긴다(`LOPHN_AGENT_CREDENTIAL`).
export const harnessStartTurn = defineMemory({
  resource: "harness",
  method: "start_turn",
  name: "HarnessStartTurn",
  changes: [],
  input: z.strictObject({
    session: idSchema("ses"),
    input_message: idSchema("msg"),
  }),
  output: z.strictObject({ turn: idSchema("trn"), credential: z.string() }),
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
  changes: [],
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
  changes: [],
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
  changes: [],
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
  changes: [],
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
