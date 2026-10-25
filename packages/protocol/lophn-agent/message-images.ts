import { z } from "zod";
import { defineFile, defineMemory, defineUpload } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";

// 사람이 메시지에 붙인 이미지다. 메시지 content는 글뿐이라 이미지는 먼저 올려 id를 받고, 글 끝에
// `Attached image: open with image.read path "attachment:<id>".` 줄을 적는다. agent는 image.read로 연다.
// 이미지는 session에 묶인다: 다른 session의 id로는 열리지 않는다.
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

export const messageImageIdSchema = idSchema("att");

// 바이트는 body이고 input은 header로 온다.
export const messageImageUpload = defineUpload({
  resource: "message-images",
  method: "upload",
  name: "UploadMessageImage",
  input: z.strictObject({
    session: idSchema("ses"),
    content_type: messageImageTypeSchema,
    bytes: z.number().int().min(1).max(MESSAGE_IMAGE_MAX_BYTES),
  }),
  output: z.object({ id: messageImageIdSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
  max_bytes: MESSAGE_IMAGE_MAX_BYTES,
});

const messageImageTarget = {
  session: idSchema("ses"),
  image: messageImageIdSchema,
};

// 사람 화면이 다시 열 때 그린다. Content-Type은 파일의 실제 형식이다.
export const messageImageRead = defineFile({
  resource: "message-images",
  method: "read",
  name: "ReadMessageImage",
  input: z.strictObject(messageImageTarget),
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// image.read가 `attachment:<id>`를 파일 경로로 푼다. credential의 session과 입력의 session이 다르면 forbidden이다.
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
