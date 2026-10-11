// context worker와 core 사이의 계약(docs/architecture/documents.md 2.4). 공개 route가 아니다.
// - 감독 pipe의 worker_request: `context.index`, `context.check`의 요청과 답.
// - core가 요청을 만들 때 reader Worker에서 읽는 내부 read `context.work_input`.
// worker는 `lophn.db`를 열지 않고 core에도 닿지 않는다. 낼 command(`context.record_violations`,
// `bundle.finish_check`)는 답에 실어 보내고, core가 좁은 machine 자격으로 낸다.
import { z } from "zod";
import { defineRead, sha256Schema, withReadCommon } from "../platform/mod.ts";
import {
  bundleFinishCheckRequestSchema,
  bundleIdSchema,
  checkFindingSchema,
  checkIdSchema,
  ctxIdSchema,
  violationSchema,
  violationsRecordRequestSchema,
} from "./context-api.ts";
import {
  bundleContentSchema,
  contractNameSchema,
  contractTypeNameSchema,
  contractVisibilitySchema,
} from "./context-contract.ts";

export const CONTEXT_WORK_OPS = {
  index: "context.index",
  check: "context.check",
  preview: "context.preview",
} as const;

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

// Project 폴더의 절대 경로. 같은 상대 경로가 여럿에 있으면 앞 폴더가 이긴다.
const rootsSchema = z.array(z.string().min(1).startsWith("/")).max(64);

const savedViewSchema = z.strictObject({
  name: z.string().min(1),
  search: contractNameSchema,
  inputs: z.record(z.string(), z.unknown()),
});

// 같은 project의 다른 context가 내놓은 type(validate의 ExternalType).
const externalTypeSchema = z.strictObject({
  context: z.string().min(1),
  name: contractTypeNameSchema,
  visibility: contractVisibilitySchema,
  key: z.string().min(1),
  fields: z.array(z.strictObject({
    name: contractNameSchema,
    visibility: contractVisibilitySchema,
    value_type: z.string().min(1),
  })),
});

// 앱 read 명령의 효과. 앱 데이터는 읽지 않고 계약이 가리키는 명령의 효과만 검사한다.
const appCommandSchema = z.strictObject({
  app: z.string().min(1),
  command: z.string().min(1),
  effect: z.enum(["read", "write", "external"]),
});

// worker가 core에 내 달라고 하는 command. core는 요청의 context·bundle·check와 맞는지 다시 본다.
export const contextSubmissionSchema = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("context.record_violations"),
    input: violationsRecordRequestSchema,
  }),
  z.strictObject({
    command: z.literal("bundle.finish_check"),
    input: bundleFinishCheckRequestSchema,
  }),
]);
export type ContextSubmission = z.infer<typeof contextSubmissionSchema>;

export const contextIndexRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // 적용 판. core가 blob을 읽어 싣는다.
  bundle: bundleContentSchema,
  bundle_hash: sha256Schema,
  // ledger가 마지막으로 기록한 위반 수(contexts.violation_mark)
  recorded_count: count,
  roots: rootsSchema,
});
export type ContextIndexRequest = z.infer<typeof contextIndexRequestSchema>;

export const contextIndexResponseSchema = z.strictObject({
  scanned: count,
  changed: count,
  removed: count,
  extracted: z.boolean(),
  violation_count: count,
  submissions: z.array(contextSubmissionSchema).max(1),
});
export type ContextIndexResponse = z.infer<typeof contextIndexResponseSchema>;

export const contextCheckRequestSchema = z.strictObject({
  context: ctxIdSchema,
  check: checkIdSchema,
  // submit한 판의 content 그대로. 모양 검사는 worker의 check runner가 한다.
  bundle: z.record(z.string(), z.unknown()),
  bundle_hash: sha256Schema,
  roots: rootsSchema,
  user_saved_views: z.array(savedViewSchema),
  external_types: z.array(externalTypeSchema),
  app_commands: z.array(appCommandSchema),
});
export type ContextCheckRequest = z.infer<typeof contextCheckRequestSchema>;

export const contextCheckResponseSchema = z.strictObject({
  status: z.enum(["passed", "failed"]),
  snapshot_hash: sha256Schema,
  violation_count: count,
  submissions: z.array(contextSubmissionSchema).max(1),
});
export type ContextCheckResponse = z.infer<typeof contextCheckResponseSchema>;

// context.preview: 만드는 중인 판을 지금 파일에 돌려 본다. 낼 command가 없고, 위반은 문구 없이 전부 돌려준다.
export const contextPreviewWorkRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // draft content JSON 그대로. 모양 검사는 worker의 check runner가 한다.
  draft: z.record(z.string(), z.unknown()),
  roots: rootsSchema,
  external_types: z.array(externalTypeSchema),
  app_commands: z.array(appCommandSchema),
});
export type ContextPreviewWorkRequest = z.infer<
  typeof contextPreviewWorkRequestSchema
>;

export const contextPreviewWorkResponseSchema = z.strictObject({
  types: z.array(z.strictObject({
    type: contractTypeNameSchema,
    count,
  })),
  findings: z.array(checkFindingSchema),
  violation_count: count,
  violations: z.array(violationSchema),
});
export type ContextPreviewWorkResponse = z.infer<
  typeof contextPreviewWorkResponseSchema
>;

// ---------- core가 reader Worker에서 읽는 내부 read ----------

export const contextWorkInputRequestSchema = z.strictObject({
  context: ctxIdSchema,
  // 있으면 이 검사의 후보 판과 saved view도 읽는다.
  check: checkIdSchema.optional(),
  // 있으면 이 context의 draft 판 content를 읽는다(context.preview). check와 함께 쓰지 않는다.
  bundle: bundleIdSchema.optional(),
});
export const contextWorkInputReadSchema = withReadCommon(z.object({
  context: ctxIdSchema,
  roots: rootsSchema,
  recorded_count: count,
  // 활성 context의 적용 판. 만드는 중이거나 보관된 context는 null이다.
  applied: z.strictObject({
    bundle_hash: sha256Schema,
    content: bundleContentSchema,
  }).nullable(),
  // check를 물었고 그 검사가 아직 도는 중(running)일 때만 있다.
  candidate: z.strictObject({
    check: checkIdSchema,
    bundle_hash: sha256Schema,
    content: z.record(z.string(), z.unknown()),
  }).nullable(),
  // bundle을 물었을 때만 있다. 그 context의 draft 상태 판. 없는 판·다른 context의 판은 not_found, draft가
  // 아니면 conflict로 읽기가 실패한다.
  draft: z.strictObject({
    bundle: bundleIdSchema,
    content: z.record(z.string(), z.unknown()),
  }).nullable(),
  user_saved_views: z.array(savedViewSchema),
  external_types: z.array(externalTypeSchema),
}));
export type ContextWorkInput = z.infer<typeof contextWorkInputReadSchema>;

// 공개 route 목록(CONTEXT_API_ROUTES)에 넣지 않는다. core가 소유자로 읽는 내부 read다.
export const contextWorkInputRoute = defineRead({
  resource: "contexts",
  method: "work_input",
  name: "context.work_input",
  input: contextWorkInputRequestSchema,
  output: contextWorkInputReadSchema,
  actors: ["machine"],
  errors: [
    "invalid_input",
    "not_found",
    "conflict",
    "unavailable",
    "internal",
  ],
});
