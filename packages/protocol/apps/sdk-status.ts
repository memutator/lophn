import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema } from "./channel-values.ts";

// 앱이 고정한 내장 SDK(@lophn/*)의 판과 lophn이 지금 가진 판의 차이다(`architecture/app-call.md`의 "SDK 상태").
// - required: 고정 판이 지원 하한(`lophn.supported_from`)보다 옛것이다. 앱이 못 뜨거나 곧 못 뜬다.
// - available: 하한 이상이지만 지금 판보다 옛것이다. 옛 판으로 돌고 새 기능만 못 쓴다.
// - current: 지금 판이다.
// notes는 `migrate-sdk` skill의 메모 file 이름이다(고정 판 다음부터 지금 판까지, 오래된 것이 먼저). unreviewed는 home이 그 앱을 두고 마지막으로
// 결정한 판(review의 through)과 고정 판 가운데 높은 쪽 다음부터 지금 판까지의 메모다(결정이 없으면 notes와 같다).
export const SDK_LEVELS = ["required", "available", "current"] as const;
export const sdkLevelSchema = z.enum(SDK_LEVELS);
export type SdkLevel = z.infer<typeof sdkLevelSchema>;

export const sdkStatusEntrySchema = z.object({
  sdk: z.string().min(1),
  pinned: z.string().min(1),
  current: z.string().min(1),
  supported_from: z.string().min(1).nullable(),
  level: sdkLevelSchema,
  notes: z.array(z.string().min(1)),
  unreviewed: z.array(z.string().min(1)),
});
export type SdkStatusEntry = z.infer<typeof sdkStatusEntrySchema>;

// home의 SDK 업데이트 결정(`architecture/ui-kit.md`의 "SDK 업데이트 감지와 맡기기"). leave는 그대로 두기, update는 판 올리기(고른 기능과 같이)다.
export const SDK_DECISIONS = ["leave", "update"] as const;
export const sdkDecisionSchema = z.enum(SDK_DECISIONS);
export type SdkDecision = z.infer<typeof sdkDecisionSchema>;

// 고른 기능의 상태다. open은 앱 lophn이 결과를 아직 내지 않은 것이다. 결과를 안 내면 끝난 것으로 보이지 않는다.
export const SDK_FEATURE_STATES = [
  "open",
  "done",
  "changed",
  "skipped",
] as const;
export const sdkFeatureStateSchema = z.enum(SDK_FEATURE_STATES);
export type SdkFeatureState = z.infer<typeof sdkFeatureStateSchema>;

export const sdkFeatureSchema = z.object({
  id: idSchema("sdf"),
  title: z.string().min(1),
  state: sdkFeatureStateSchema,
  outcome: z.string().nullable(),
  state_at: atSchema,
});
export type SdkFeature = z.infer<typeof sdkFeatureSchema>;

// 앱의 마지막 결정이다. through는 그때의 지금 판(SDK 이름 → 판)이고 program이 채운다. migrated는 update일 때 고정 판이 through에 닿았는지(저장하지
// 않고 지금 pin과 견줘 계산한다)이고 leave면 null이다.
export const sdkReviewSummarySchema = z.object({
  id: idSchema("sdr"),
  decision: sdkDecisionSchema,
  at: atSchema,
  through: z.record(z.string(), z.string()),
  migrated: z.boolean().nullable(),
  features: z.array(sdkFeatureSchema),
});
export type SdkReviewSummary = z.infer<typeof sdkReviewSummarySchema>;

export const appSdkStatusSchema = z.object({
  app: appIdSchema,
  name: z.string().min(1),
  release: releaseIdSchema,
  sdks: z.array(sdkStatusEntrySchema),
  review: sdkReviewSummarySchema.nullable(),
});
export type AppSdkStatus = z.infer<typeof appSdkStatusSchema>;

// 보관하지 않은, 켜진 release가 있는 앱만 싣는다. 보관한 앱과 없는 앱은 agent에게 not_found다.
// agent는 자기 범위의 앱만 본다(app workspace는 자기 앱).
export const appSdkStatus = defineRead({
  resource: "apps",
  method: "sdk_status",
  name: "app.sdk_status",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: z.object({ apps: z.array(appSdkStatusSchema) }),
  actors: ["user", "machine", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const sdkFeatureProposalSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  // 앱 lophn에게 주는 제안 글이다. 사람이 고른 것은 아이디어이고 최종 모양이 아니다.
  proposal: z.string().trim().min(1).max(1000),
  // 근거 메모 file 이름(`notes`나 `unreviewed`에 나온 것).
  note: z.string().min(1),
});

// home lophn이 앱 하나의 결정을 낸다. update는 review·feature를 적고 같은 동작에서 그 앱의 lophn에게 handoff call을 보낸다(reply none).
// 판·메모 목록·글 틀은 program이 채운다. call이 거절되면 아무것도 적지 않고 거절을 돌려준다. 메인 스레드가 지금 판을 읽어 internal
// command(`appSdkReviewRecord`)로 넘기는 command route다(release 준비처럼 writer 앞에서 처리한다).
export const appSdkDecide = defineCommand({
  resource: "apps",
  method: "sdk_decide",
  name: "app.sdk_decide",
  changes: [{ name: "apps", id: (input) => input.app }],
  input: z.strictObject({
    app: appIdSchema,
    decision: sdkDecisionSchema,
    features: z.array(sdkFeatureProposalSchema).max(20).optional(),
  }),
  output: z.object({
    review: idSchema("sdr"),
    call: idSchema("cal").nullable(),
    features: z.array(z.object({ id: idSchema("sdf"), title: z.string() })),
  }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// core 안 machine만 쓴다. 기능 ID는 handoff 글에 먼저 실어야 해서 메인 스레드 handler가 정한다. 입력의 판·본문은 `appSdkDecide`의 handler가 program 값으로 채운 것이다.
export const appSdkReviewRecord = defineCommand({
  resource: "apps",
  method: "sdk_review_record",
  name: "app.sdk_review_record",
  changes: [{ name: "apps", id: (input) => input.app }],
  input: z.strictObject({
    app: appIdSchema,
    session: idSchema("ses"),
    turn: idSchema("trn"),
    decision: sdkDecisionSchema,
    through: z.record(z.string(), z.string()),
    features: z.array(sdkFeatureProposalSchema.extend({ id: idSchema("sdf") })),
    // update일 때만 있다. 글 block 하나다(protocol 최상위 사이 순환을 피하려고 call의 content block schema를 가져오지 않는다).
    // redaction과 blob 준비는 call 본문과 같은 길로 writer 앞에서 하고 모양은 call의 schema가 다시 검사한다.
    body: z
      .array(
        z.strictObject({ type: z.literal("text"), text: z.string().min(1) }),
      )
      .min(1)
      .optional(),
  }),
  output: z.object({
    review: idSchema("sdr"),
    call: idSchema("cal").nullable(),
    features: z.array(z.object({ id: idSchema("sdf"), title: z.string() })),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

// 앱 lophn이 handoff로 받은 기능 하나의 결과를 낸다. 자기 앱의 기능만 고친다.
export const appSdkFeature = defineCommand({
  resource: "apps",
  method: "sdk_feature",
  name: "app.sdk_feature",
  changes: ["apps"],
  input: z.strictObject({
    feature: idSchema("sdf"),
    state: z.enum(["done", "changed", "skipped"]),
    note: z.string().trim().min(1).max(300).optional(),
  }),
  output: z.object({
    feature: idSchema("sdf"),
    state: sdkFeatureStateSchema,
  }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: ["forbidden", "not_found"],
});
