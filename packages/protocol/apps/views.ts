import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import {
  appIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
  sha256Schema,
} from "./channel-values.ts";

// 앱 화면(view)의 binding. host(shell main, 폰)가 view id를 만들어 열고, core가 그 view가 어느 앱·release·process에
// 묶였는지, 어떤 operation을 부를 수 있는지 정한다. 표의 key는 (요청 credential의 principal, view)다. 다른 owner의
// view는 없는 view와 같다. 표는 core 메모리에만 있다.

// host가 만든 불투명 id. 화면 page가 낸 값이 아니다.
export const appViewIdSchema = z
  .string()
  .min(8)
  .max(64)
  .refine((value) => !/\p{Cc}/u.test(value), {
    message: "view id contains a control character",
  });

const nonBlank = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0 && !/\p{Cc}/u.test(value), {
    message: "value cannot be blank or contain controls",
  });

export const appViewWorkspaceSchema = z.strictObject({
  kind: z.enum(["project", "home", "app"]),
  id: z.string().min(1),
  folders: z.array(z.string()),
});

export const appViewsOpenInputSchema = z.strictObject({
  view: appViewIdSchema,
  mode: z.enum(["live", "preview"]),
  app: appIdSchema,
  // live에서 값은 처음 열 때의 전제다: 그 release가 돌고 있어야 한다(아니면 conflict). card가 아닌 live view는 그 뒤 도는
  // release를 따르고, 이미 연 view를 다시 열 때는 이 값을 보지 않는다. null이면 지금 도는 release에 묶는다. card와 preview는
  // 다시 열 때도 처음 값과 같아야 한다. preview에서 null이면 어떤 preview든 받는다.
  release: releaseIdSchema.nullable(),
  screen: nonBlank,
  place: nonBlank,
  params: jsonObjectSchema.optional(),
  workspace: appViewWorkspaceSchema.optional(),
});
export type AppViewsOpenInput = z.infer<typeof appViewsOpenInputSchema>;

export const appViewsOpenOutputSchema = z.strictObject({
  view: appViewIdSchema,
  release: releaseIdSchema.nullable(),
  bundle_hash: sha256Schema,
  process_nonce: processNonceSchema,
  // 화면 선언의 params schema를 통과한(정규화한) 값. 주지 않았으면 null이다.
  params: jsonObjectSchema.nullable(),
});
export type AppViewsOpenOutput = z.infer<typeof appViewsOpenOutputSchema>;

export const appViewsOpen = defineMemory({
  resource: "app_views",
  method: "open",
  name: "app_views.open",
  input: appViewsOpenInputSchema,
  output: appViewsOpenOutputSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
});

export const appViewsCallInputSchema = z.strictObject({
  view: appViewIdSchema,
  operation: z.string(),
  input: jsonValueSchema,
});

// 앱이 낸 오류의 code는 일곱 오류 code가 아니다. outcome 안에만 있다.
export const appViewOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: jsonValueSchema }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: z.string(), message: z.string() }),
  }),
]);
export type AppViewOutcome = z.infer<typeof appViewOutcomeSchema>;

export const appViewsCall = defineMemory({
  resource: "app_views",
  method: "call",
  name: "app_views.call",
  input: appViewsCallInputSchema,
  output: z.strictObject({ outcome: appViewOutcomeSchema }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});

export const appViewsClose = defineMemory({
  resource: "app_views",
  method: "close",
  name: "app_views.close",
  input: z.strictObject({ view: appViewIdSchema }),
  output: z.strictObject({ closed: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input"],
});

export const APP_VIEW_ROUTES = [
  appViewsOpen,
  appViewsCall,
  appViewsClose,
] as const;

// `AppViewEvent`의 payload. owner의 Gateway session에만 간다.
export const appViewEventPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    owner: z.string().min(1),
    view: appViewIdSchema,
    kind: z.literal("event"),
    source: z.string().min(1),
    event: z.string().min(1),
    payload: jsonValueSchema,
  }),
  z.strictObject({
    owner: z.string().min(1),
    view: appViewIdSchema,
    kind: z.literal("rebound"),
    release: releaseIdSchema.nullable(),
    bundle_hash: sha256Schema,
    process_nonce: processNonceSchema,
  }),
  z.strictObject({
    owner: z.string().min(1),
    view: appViewIdSchema,
    kind: z.literal("lost"),
    reason: z.enum(["app_stopped", "app_archived", "conflict", "evicted"]),
  }),
]);
export type AppViewEventPayload = z.infer<typeof appViewEventPayloadSchema>;
