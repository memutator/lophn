import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand } from "../base/route.ts";
import { seqSchema } from "../base/values.ts";
import { HARNESS_RUNTIMES } from "./agent-values.ts";

// core 안 harness 실행(터미널 GUI 탭과 background 실행)이 ledger를 고치는 machine command와 기록 모양이다.
// 모든 route는 runtime이 harness인 session이 아니면 `forbidden`이다.

const harnessRuntimeSchema = z.enum(HARNESS_RUNTIMES);

// 도는 turn에서 harness가 낸 메시지를 ledger에 남기는 조각 모양이다. 글과 harness가 쓴 tool(`harness_tool`)만 받는다.
export const recordPartSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({
    kind: z.literal("harness_tool"),
    name: z.string().min(1),
    summary: z.string(),
    status: z.enum(["running", "done", "failed"]),
  }),
]);
export type HarnessRecordPart = z.infer<typeof recordPartSchema>;

// harness가 알려 준 session id를 lophn session에 둔다. core 안 실행기가 machine 자격으로 부른다.
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

// 터미널 GUI 탭(harness-gui)의 팀원 session을 연다. core 안 GUI 연결이 machine 자격으로 부른다. agent는 그 harness의 내장 coding agent이고
// workspace는 그 탭의 project다.
export const openHarnessMember = defineCommand({
  resource: "harness",
  method: "open_member",
  name: "OpenHarnessMember",
  changes: [],
  input: z.strictObject({
    id: idSchema("ses"),
    harness: harnessRuntimeSchema,
    project: idSchema("prj"),
    // 그 탭 CLI 자신의 session id. 아직 모르면 null이다.
    external_session_id: z.string().min(1).max(256).nullable(),
  }),
  output: z.strictObject({ id: idSchema("ses"), state_seq: seqSchema }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

// harness session의 turn이 받은 result call에 답하지 못하고 끝났다(멈춤, 실패, 탭이나 handle이 닫힘, turn이 열리지 않음). call을
// failed(receiver_ended)로 닫아 보낸 쪽에 돌려준다. session은 열린 채 남아 archive가 닫아 주지 않으므로 따로 닫는다. 이미 닫힌 call이면
// `failed: false`다.
export const failHarnessMemberCall = defineCommand({
  resource: "harness",
  method: "fail_call",
  name: "FailHarnessMemberCall",
  changes: [],
  input: z.strictObject({
    session: idSchema("ses"),
    call: idSchema("cal"),
  }),
  output: z.strictObject({ failed: z.boolean() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["forbidden", "not_found", "unavailable"],
});

export const HARNESS_HOST_ROUTES = [
  bindHarnessSession,
  openHarnessMember,
  failHarnessMemberCall,
] as const;
