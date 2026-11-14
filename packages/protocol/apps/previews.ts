import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { defineMemory, defineRead } from "../base/route.ts";
import {
  appIdSchema,
  processNonceSchema,
  releaseIdSchema,
  sha256Schema,
} from "./channel-values.ts";
import { relativePathSchema } from "../projects/values.ts";
import { runtimeReasonSchema } from "./runtime.ts";

// preview는 별도 entity·ID·운영 상태·ledger 항목이 아니다.
// 통로 값과 view session은 apps/runtime·shell/app-frame이 소유한다.
const previewInputSchema = z.strictObject({
  app: appIdSchema,
  bundle_hash: sha256Schema,
  release: releaseIdSchema.nullable(),
  // 봉인된 bundle 안의 상대 경로(manifest의 files[].path)다.
  fixture: relativePathSchema.nullable(),
});

// preview 프로세스의 현재 관측. RuntimeObservation의 mode=preview 값이다.
const previewObservationSchema = z
  .object({
    app: appIdSchema,
    release: releaseIdSchema.nullable(),
    bundle_hash: sha256Schema,
    mode: z.literal("preview"),
    process_nonce: processNonceSchema,
    endpoint: z.string().min(1).nullable(),
    ready: z.boolean(),
    accepting: z.literal(false),
    reason: runtimeReasonSchema.optional(),
  })
  .refine((value) => value.ready || value.reason !== undefined, {
    message: "observation that is not ready needs a reason",
  });
export type PreviewObservation = z.infer<typeof previewObservationSchema>;

const readActors = ["user", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 살아 있는 preview 프로세스의 시작 요청. App 활성 참조를 바꾸지 않는다.
export const previewsStartInputSchema = z.strictObject({
  input: previewInputSchema,
});
export const previewsStartOutputSchema = z.object({
  process_nonce: processNonceSchema,
  ready: z.literal(false),
});
export const previewsStart = defineRead({
  resource: "previews",
  method: "start",
  name: "previews.start",
  input: previewsStartInputSchema,
  output: previewsStartOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const previewsGetInputSchema = z.strictObject({
  app: appIdSchema,
  process_nonce: processNonceSchema.optional(),
});
export const previewsGetOutputSchema = z.object({
  observation: previewObservationSchema.nullable(),
  observed_at: atSchema.nullable(),
});
export const previewsGet = defineRead({
  resource: "previews",
  method: "get",
  name: "previews.get",
  input: previewsGetInputSchema,
  output: previewsGetOutputSchema,
  // preview가 뜨고 ready가 되고 끝나면 core가 app_runtime 변경을 낸다(apps/record_preview, preview service).
  reads: [{ name: "app_runtime", id: (input) => input.app }],
  actors: readActors,
  errors: readErrors,
});

export const previewsStopInputSchema = z.strictObject({
  app: appIdSchema,
  process_nonce: processNonceSchema,
});
export const previewsStopOutputSchema = z.object({ stopped: z.literal(true) });
export const previewsStop = defineRead({
  resource: "previews",
  method: "stop",
  name: "previews.stop",
  input: previewsStopInputSchema,
  output: previewsStopOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// supervisor(preview 자식의 부모)가 그 자식이 ready가 됐거나 끝났다고 알린다. core는 관측을 supervisor에서
// 읽으므로 따로 담지 않고, 화면이 previews.get을 다시 읽게 변경만 낸다. 지금 preview가 아닌 nonce는 recorded가 false다.
export const appRecordPreview = defineMemory({
  resource: "apps",
  method: "record_preview",
  name: "app.record_preview",
  changes: [{ name: "app_runtime", id: (input) => input.app }],
  input: z.strictObject({
    app: appIdSchema,
    process_nonce: processNonceSchema,
    state: z.enum(["ready", "exited"]),
    reason: runtimeReasonSchema.optional(),
  }),
  output: z.object({ recorded: z.boolean() }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden"],
});

export const PREVIEW_ROUTES = [
  previewsStart,
  previewsGet,
  previewsStop,
  appRecordPreview,
] as const;
