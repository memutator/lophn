import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import {
  appIdSchema,
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  toolNameSchema,
} from "./channel-values.ts";
import { traceIdSchema } from "./calls/caller.ts";

// 앱 event. 앱 process가 `@lophn/cap-tool`의 publish로 내는 일이 일어난 뒤의 알림이다(`architecture/event.md`).
// 앱은 입력에 없다. 앱 자식 credential이 고정한 앱이다. 앱의 active release가 선언한 event이고 payload가 선언한
// schema와 맞아야 한다(아니면 invalid_input). core는 구독자의 답을 기다리지 않고, 저장하지 않고, 다시 보내지 않는다.
// 발행 기록(누가 어느 event를 언제 몇 구독자에게 냈나)만 앱마다 최근 EVENT_PUBLICATIONS_KEPT개 남기고 payload는 남기지 않는다.

// 알림이라 작게 둔다. 이 크기는 payload를 JSON으로 쓴 byte다.
export const EVENT_PAYLOAD_MAX_BYTES = 16 * 1024;
export const EVENT_PUBLICATIONS_KEPT = 200;

const publishInputSchema = z.strictObject({
  event: toolNameSchema,
  payload: jsonValueSchema,
  // 발행이 앱 handler 안에서 일어났으면 그 invocation이다. 구독 handler의 호출이 이 invocation의 사슬로 루프·깊이 검사를
  // 받게 한다. 없거나 도는 호출이 아니면 사슬 없이 낸다(부모 invocation이 필요하지 않다).
  parent_invocation: invocationIdSchema.nullable(),
});

export type AppEventPublishInput = z.infer<typeof publishInputSchema>;

// broker가 받는 앱 process의 요청. 자식 연결이 정한 nonce·mode를 함께 싣는다.
export const brokerEventPublishInputSchema = publishInputSchema.extend({
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
});

// reachable은 구독을 선언했고 그 순간 켜져 있던 구독자 수, unreachable은 켜져 있지 않아 받지 못한 수다. refused는 reachable 가운데
// event 고리(같은 앱이 이 event를 부른 사슬에 이미 있음)나 깊이 한도 때문에 호출을 넘기지 않은 수다. 호출을 넘긴 뒤의 거절이나 실패는
// 이 수에 반영되지 않는다(그 호출의 invocation 기록이 말한다).
const publishCountsSchema = {
  reachable: z.number().int().nonnegative(),
  unreachable: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
};
export const eventPublishOutputSchema = z.object({
  publication: idSchema("pub"),
  ...publishCountsSchema,
});

export const appEventPublish = defineMemory({
  resource: "app_events",
  method: "publish",
  name: "app_events.publish",
  changes: [],
  input: publishInputSchema,
  output: eventPublishOutputSchema,
  actors: ["app"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const eventPublicationSchema = z.object({
  id: idSchema("pub"),
  // 발행한 앱. core가 내는 event(`lophn`)도 같은 모양이다.
  publisher: z.union([appIdSchema, z.literal("lophn")]),
  release: releaseIdSchema.nullable(),
  event: toolNameSchema,
  trace_id: traceIdSchema,
  at: atSchema,
  ...publishCountsSchema,
});
export type EventPublication = z.infer<typeof eventPublicationSchema>;

const EVENT_PUBLICATIONS_MAX_COUNT = 200;

export const appEventPublications = defineRead({
  resource: "apps",
  method: "event_publications",
  name: "app.event_publications",
  input: z.strictObject({
    app: appIdSchema,
    event: toolNameSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(EVENT_PUBLICATIONS_MAX_COUNT).optional(),
  }),
  output: withReadCommon(
    z.object({ publications: z.array(eventPublicationSchema) }),
  ),
  reads: [{ name: "releases", id: (input) => input.app }],
  actors: ["user", "agent", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const APP_EVENT_ROUTES = [
  appEventPublish,
  appEventPublications,
] as const;
