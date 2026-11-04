import { z } from "zod";
import { defineFile, defineMemory, defineUpload } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";

// 메시지에 싣는 이미지다. 바이트는 먼저 올려 blob이 되고(`UploadMessageImage`, agent는 `PrepareMessageImage`),
// 그 hash를 image block에 싣는다(`content-block.ts`). 블록을 쓴 메시지가 그 blob의 영구 참조를 등록하고,
// 이미지는 그 참조를 가진 메시지의 session에서만 읽힌다.
// 옛 메시지는 글 끝에 `Attached image: ... "attachment:<id>"` 줄을 가진다. 그 id(`att_…`)는 올린 파일을 가리키고
// `image.read`와 `ReadMessageImage`가 그대로 읽는다.
export const MESSAGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MESSAGE_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;
export const messageImageTypeSchema = z.enum(
  Object.keys(MESSAGE_IMAGE_TYPES) as [
    keyof typeof MESSAGE_IMAGE_TYPES,
    ...(keyof typeof MESSAGE_IMAGE_TYPES)[],
  ],
);

// 이미지 blob의 준비 용도와, 이미지를 담은 메시지가 영구 참조를 등록하는 field다(owner는 본문과 같은 message).
export const MESSAGE_IMAGE_PURPOSE = "message_image";
export const MESSAGE_IMAGE_FIELD = "image";

export const messageImageIdSchema = idSchema("att");
// 옛 첨부 id이거나 image block의 blob hash다.
const messageImageRefSchema = z.union([messageImageIdSchema, sha256Schema]);

const imageErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 사람 화면이 올린다. 바이트는 body이고 input은 header로 온다. 결과 blob hash를 image block에 싣는다.
export const messageImageUpload = defineUpload({
  resource: "message-images",
  method: "upload",
  name: "UploadMessageImage",
  input: z.strictObject({
    content_type: messageImageTypeSchema,
    bytes: z.number().int().min(1).max(MESSAGE_IMAGE_MAX_BYTES),
  }),
  output: z.object({ blob: sha256Schema }),
  actors: ["user"],
  errors: [...imageErrors],
  max_bytes: MESSAGE_IMAGE_MAX_BYTES,
});

// agent는 runtime loopback이 JSON뿐이라 바이트를 base64로 싣는다. 요청 상한(256KiB) 안에 들어가는 크기다.
export const MESSAGE_IMAGE_CALL_MAX_BYTES = 180_000;
export const messageImagePrepare = defineMemory({
  resource: "message-images",
  method: "prepare",
  name: "PrepareMessageImage",
  input: z.strictObject({
    data_base64: z
      .string()
      .min(1)
      .max(Math.ceil(MESSAGE_IMAGE_CALL_MAX_BYTES / 3) * 4),
  }),
  output: z.object({ blob: sha256Schema, mimeType: messageImageTypeSchema }),
  actors: ["agent"],
  errors: [...imageErrors],
});

const messageImageTarget = {
  session: idSchema("ses"),
  image: messageImageRefSchema,
};

// 사람 화면이 그린다. Content-Type은 파일의 실제 형식이다. session의 메시지가 참조하지 않는 blob은 not_found다.
export const messageImageRead = defineFile({
  resource: "message-images",
  method: "read",
  name: "ReadMessageImage",
  input: z.strictObject(messageImageTarget),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: [...imageErrors],
});

// runtime이 model에 싣기 전에 읽을 파일 경로를 푼다(`image.read`의 `attachment:<id>`도 같다). credential의 session과
// 입력의 session이 다르면 forbidden이고, session의 메시지가 참조하지 않는 blob은 not_found다.
export const messageImagePath = defineMemory({
  resource: "message-images",
  method: "path",
  name: "ResolveMessageImage",
  input: z.strictObject(messageImageTarget),
  output: z.object({ path: z.string(), media_type: messageImageTypeSchema }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

export const MESSAGE_IMAGE_ROUTES = [
  messageImageUpload,
  messageImageRead,
] as const;
