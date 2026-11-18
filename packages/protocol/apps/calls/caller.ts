import { z } from "zod";
import { idSchema } from "../../base/ids.ts";
import { appIdSchema } from "../../projects/values.ts";
import {
  APP_CALL_DEPTH_LIMIT,
  invocationIdSchema,
  opaqueSchema,
  releaseIdSchema,
  toolCallIdSchema,
  toolNameSchema,
} from "../channel-values.ts";

// W3C trace id(32 hex). `architecture/observability.md`.
export const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

// tool을 부른 쪽. kind가 호출 route의 actor와 맞는지는 core가 본다.
export const appToolCallerSchema = z.discriminatedUnion("kind", [
  // 앱 화면을 연 사람. 앱·release·mode는 호출 입력의 target이 싣는다. `device`는 폰에서 한 write가 맞춰질 때
  // core가 그 invocation에 붙인다(view_session은 폰의 변경 id). `machine`은 다른 기계에서 폴더로 온 변경을 적용할 때
  // 붙인다(view_session은 주인 기계 sync log의 seq). 둘은 같이 없고, 화면이 보내는 호출에는 없다.
  z
    .strictObject({
      kind: z.literal("person"),
      view_session: opaqueSchema,
      device: idSchema("dev").optional(),
      machine: idSchema("mch").optional(),
    })
    .refine(
      (caller) => caller.device === undefined || caller.machine === undefined,
      {
        message: "a person caller comes from a device or a machine, not both",
      },
    ),
  z.strictObject({
    kind: z.literal("agent"),
    session: idSchema("ses"),
    turn: idSchema("trn"),
    tool_call: toolCallIdSchema,
  }),
  z.strictObject({
    kind: z.literal("app"),
    app: appIdSchema,
    release: releaseIdSchema,
    parent_invocation: invocationIdSchema.nullable(),
  }),
  // job이 연 tool run의 호출. job·run 모양은 core가 만든 자격과 맞춰 본다.
  z.strictObject({
    kind: z.literal("program"),
    job: idSchema("job"),
    job_run: idSchema("jbr"),
  }),
  // flow instance가 연 tool run의 호출.
  z.strictObject({ kind: z.literal("flow"), instance: idSchema("wfi") }),
  // event를 받은 구독 handler의 호출. 발행자는 앱이거나 core(`lophn`)이고, publication과 trace_id는 그 발행의
  // 기록(`app.event_publications`)과 이어 준다. 발행한 앱이 부모 invocation 안에서 냈으면 그 invocation이 parent다
  // (앱 호출과 같은 루프·깊이 검사를 받는다). chain은 이 event를 부른 인과의 앱들(발행자 포함, 먼저 나온 순)이다:
  // 발행이 구독 handler 안에서 일어나면 그 handler를 부른 chain에 이어진다. 전달은 구독자를 기다리지 않아 부모 호출이
  // 이미 끝났을 수 있으므로 앞선 호출 사슬은 살아 있는 호출 표가 아니라 event 자신이 싣는다.
  z.strictObject({
    kind: z.literal("event"),
    publisher: z.union([appIdSchema, z.literal("lophn")]),
    event: toolNameSchema,
    publication: idSchema("pub"),
    trace_id: traceIdSchema,
    chain: z.array(appIdSchema).max(APP_CALL_DEPTH_LIMIT),
    parent_invocation: invocationIdSchema.nullable(),
    // 다른 기계에서 온 event(선언 `across_machines`)면 그 난 기계. payload는 발행 앱이 선언한 schema라 core가 칸을 더하지 않는다.
    machine: idSchema("mch").optional(),
  }),
]);
export type AppToolCaller = z.infer<typeof appToolCallerSchema>;
