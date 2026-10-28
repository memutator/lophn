import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead, defineUpload } from "../base/route.ts";
import { sha256Schema } from "../base/values.ts";
import { agentIdSchema } from "../lophn-agent/places.ts";
import { preparedBlobSchema } from "../storage/blob.ts";
import {
  appIdSchema,
  projectIdSchema,
  slugSchema,
} from "../projects/values.ts";
import { screenKeySchema } from "./channel-values.ts";
import { releaseIdSchema } from "./apps.ts";

// 앱 화면과 artifact annotation의 값과 route. 고르기는 shell이, 저장·전달은 core가 한다.

export const ANNOTATION_BATCH_MAX = 20;
const ANNOTATION_NOTE_MAX_CHARS = 2000;
// 이미지 한 장의 상한이다. shell main이 이 안으로 줄여 올린다.
export const ANNOTATION_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const ANNOTATION_SCREENSHOT_PURPOSE = "annotation_screenshot";

export const annotationIdSchema = idSchema("ann");
export const annotationBatchIdSchema = idSchema("anb");
export type AnnotationId = z.infer<typeof annotationIdSchema>;

const annotationKindSchema = z.enum(["element", "region"]);

// viewport 비율의 x와 너비, px의 y와 높이, scroll 값.
const annotationRectSchema = z.strictObject({
  x_ratio: z.number().min(0).max(1),
  width_ratio: z.number().min(0).max(1),
  y_px: z.number(),
  height_px: z.number(),
  scroll_x: z.number(),
  scroll_y: z.number(),
});

const elementText = z.string().max(200).nullable();
// 역할, 접근 이름, 보이는 글(가까운 글 포함 짧게).
const annotationElementSchema = z.strictObject({
  role: elementText,
  name: elementText,
  text: elementText,
});

// 앱 화면 위치(앱이 정한 view 이름과 route). artifact와 file은 screen이 없다(null), path는 그 안의 위치다.
const annotationViewSchema = z.strictObject({
  screen: screenKeySchema.nullable(),
  path: z.string(),
});

// annotation을 붙이는 곳. artifact는 domain 그릇 안의 artifact이고, file은 사람의 폴더에 있는 `.html`이다.
export const annotationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("app"), app: appIdSchema }),
  z.strictObject({
    kind: z.literal("artifact"),
    domain: idSchema("dom"),
    name: slugSchema,
  }),
  z.strictObject({ kind: z.literal("file"), project: projectIdSchema }),
]);
export type AnnotationTarget = z.infer<typeof annotationTargetSchema>;

const annotationScreenshotBlobSchema = z
  .strictObject(preparedBlobSchema.shape)
  .refine((value) => value.purpose === ANNOTATION_SCREENSHOT_PURPOSE, {
    message: "screenshot blob purpose must be annotation_screenshot",
  });

export const annotationInputSchema = z.strictObject({
  n: z.number().int().min(1),
  kind: annotationKindSchema,
  note: z.string().max(ANNOTATION_NOTE_MAX_CHARS),
  screenshot: annotationScreenshotBlobSchema.nullable(),
  // `List > Card > Button`처럼 바깥에서 안쪽 순서의 SDK component 겹. SDK component 안이 아니면 null.
  component: z.string().nullable(),
  element: annotationElementSchema,
  rect: annotationRectSchema,
  view: annotationViewSchema,
  // app이 아닌 target이면 null.
  release: releaseIdSchema.nullable(),
});
export type AnnotationInput = z.infer<typeof annotationInputSchema>;

const annotationSchema = z.strictObject({
  id: annotationIdSchema,
  batch: annotationBatchIdSchema,
  target: annotationTargetSchema,
  n: z.number().int().min(1),
  kind: annotationKindSchema,
  note: z.string(),
  screenshot: z
    .strictObject({
      hash: sha256Schema,
      size_bytes: z.number().int().min(0),
    })
    .nullable(),
  // `List > Card > Button`처럼 바깥에서 안쪽 순서의 SDK component 겹. SDK component 안이 아니면 null.
  component: z.string().nullable(),
  element: annotationElementSchema,
  rect: annotationRectSchema,
  view: annotationViewSchema,
  release: releaseIdSchema.nullable(),
});
export type Annotation = z.infer<typeof annotationSchema>;

const annotationBatchSchema = z.strictObject({
  id: annotationBatchIdSchema,
  target: annotationTargetSchema,
  sent_at: z.string(),
  sent_by: actorSchema,
  annotations: z.array(annotationIdSchema),
});
export type AnnotationBatch = z.infer<typeof annotationBatchSchema>;

// 읽는 쪽 값. screenshot_path는 image.read가 읽는 blob object 파일 경로다.
export const annotationReadSchema = z.strictObject({
  ...annotationSchema.shape,
  screenshot_path: z.string().nullable(),
});
export type AnnotationRead = z.infer<typeof annotationReadSchema>;

// screenshot byte를 core의 blob 준비로 올린다. 준비 참조가 annotation.send의 screenshot이다.
export const annotationUploadScreenshot = defineUpload({
  resource: "annotations",
  method: "upload_screenshot",
  name: "annotation.upload_screenshot",
  input: z.strictObject({
    blob_hash: sha256Schema,
    bytes: z.number().int().min(1).max(ANNOTATION_SCREENSHOT_MAX_BYTES),
  }),
  output: annotationScreenshotBlobSchema,
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
  max_bytes: ANNOTATION_SCREENSHOT_MAX_BYTES,
});

// 묶음 하나를 target의 받는 쪽에게 사람 메시지로 보낸다. Router 전달이
// 비동기라 ledger command가 아니라 memory route다. 저장은 core의 annotation module이 한다.
// app이면 agent(없으면 lophn)의 그 앱 place session이고, session이 null이면 새로 연다.
// artifact이면 그 artifact를 마지막으로 쓴 열린 session이고, 없으면 domain 주인 그릇 place의 lophn session이다.
// file이면 그 project place의 lophn session이다.
export const annotationSendInputSchema = z
  .strictObject({
    target: annotationTargetSchema,
    agent: agentIdSchema.optional(),
    session: idSchema("ses").nullable(),
    annotations: z
      .array(annotationInputSchema)
      .min(1)
      .max(ANNOTATION_BATCH_MAX),
  })
  .refine((value) => value.annotations.every((item, i) => item.n === i + 1), {
    message: "annotation n must run 1..N in order",
  })
  .refine((value) => value.target.kind === "app" || value.agent === undefined, {
    message: "only app annotations choose an agent",
  })
  .refine(
    (value) =>
      value.annotations.every((item) =>
        value.target.kind === "app"
          ? item.release !== null && item.view.screen !== null
          : item.release === null && item.view.screen === null,
      ),
    { message: "app annotations carry release and screen, others do not" },
  );
const annotationSendOutputSchema = z.object({
  batch: annotationBatchIdSchema,
  annotations: z.array(annotationIdSchema),
  session: idSchema("ses"),
  message: idSchema("msg"),
});
// conflict는 보관한 앱이라 새 입력을 받지 않는 경우다. 보내기는 사람의 동작이라 Gate가 없다.
export const annotationSend = defineMemory({
  resource: "annotations",
  method: "send",
  name: "annotation.send",
  input: annotationSendInputSchema,
  output: annotationSendOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unavailable"],
});

const annotationsGetInputSchema = z.union([
  z.strictObject({ annotation: annotationIdSchema }),
  z.strictObject({ batch: annotationBatchIdSchema }),
]);
const annotationsGetOutputSchema = withReadCommon(
  z.object({
    batch: annotationBatchSchema.nullable(),
    annotations: z.array(annotationReadSchema),
  }),
);
export const annotationsGet = defineRead({
  resource: "annotations",
  method: "get",
  name: "annotations.get",
  input: annotationsGetInputSchema,
  output: annotationsGetOutputSchema,
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
