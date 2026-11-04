import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { durationMsSchema, sha256Schema } from "../base/values.ts";
import { type ContentBlock, contentBlocksSchema } from "./content-block.ts";
import { messageImageTypeSchema } from "./message-images.ts";

// 본문 blob 하나의 정규 직렬화 상한이다. 요청은 본문 값을 싣고 RPC JSON 상한이 256KiB
// 이므로 id·links 여유가 요청 상한 안에 남도록, 사람 말은 64KiB(스키마가 검사)이고
// agent·machine 답은 글·카드·reasoning을 합쳐 240KiB다. call 본문과 agent·machine 답의 합계는 core가
// 준비 전에 검사한다. 이미지는 hash만 싣고 bytes는 따로 올린 blob이라 이 상한을 쓰지 않는다.
export const MESSAGE_TEXT_CONTENT_MAX_BYTES = 65536;
export const MESSAGE_CONTENT_MAX_BYTES = 245760;
// 본문 blob 준비·참조의 이름. 준비 주체는 보낸 사람의 자격이고 참조는 permanent다.
export const MESSAGE_CONTENT_PURPOSE = "message_content";
export const MESSAGE_BODY_OWNER_KIND = "message";
export const MESSAGE_BODY_FIELD = "body";
const encoder = new TextEncoder();

// `visual.show`가 대화에 보이는 앱 카드. view는 앱 선언 화면 key다.
const appCardFields = {
  kind: z.literal("app_card"),
  app: idSchema("app"),
  view: z.string().min(1),
};
const appCardPartInputSchema = z.strictObject(appCardFields);
const appCardPartSchema = z.object(appCardFields);

const textPartInputSchema = z.strictObject({
  kind: z.literal("text"),
  text: z.string(),
});
// provider가 준 읽을 수 있는 reasoning이다. 없으면 ""이고 시간을 모르면 duration_ms가 null이다.
const reasoningPartInputSchema = z.strictObject({
  kind: z.literal("reasoning"),
  text: z.string(),
  duration_ms: durationMsSchema.nullable(),
});

// content block이 저장되는 꼴이다(`contentOfBlocks`). 이미지는 blob hash로 가리킨다.
const imagePartFields = {
  kind: z.literal("image"),
  mime_type: messageImageTypeSchema,
  blob: sha256Schema,
};
const resourceLinkPartFields = {
  kind: z.literal("resource_link"),
  uri: z.string().min(1),
  name: z.string().min(1),
  mime_type: z.string().min(1).optional(),
  description: z.string().optional(),
};
const resourcePartFields = {
  kind: z.literal("resource"),
  uri: z.string().min(1),
  mime_type: z.string().min(1).optional(),
  text: z.string(),
};

const messagePartInputSchema = z.discriminatedUnion("kind", [
  textPartInputSchema,
  appCardPartInputSchema,
  reasoningPartInputSchema,
  z.strictObject(imagePartFields),
  z.strictObject(resourceLinkPartFields),
  z.strictObject(resourcePartFields),
]);
const messagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object(imagePartFields),
  z.object(resourceLinkPartFields),
  z.object(resourcePartFields),
  appCardPartSchema,
  z.object({
    kind: z.literal("reasoning"),
    text: z.string(),
    duration_ms: durationMsSchema.nullable(),
  }),
]);
const agentPartInputSchema = z.discriminatedUnion("kind", [
  textPartInputSchema,
  appCardPartInputSchema,
]);
const machinePartInputSchema = z.discriminatedUnion("kind", [
  textPartInputSchema,
  reasoningPartInputSchema,
]);

function canonicalBytes(block: unknown): number | undefined {
  try {
    return encoder.encode(canonicalize(block)).length;
  } catch {
    return undefined;
  }
}

// blob에 들어가는 바이트다. 키를 정렬한 정규 JSON(RFC 8785)이라 같은 값은 같은 바이트다.
export function serializeMessageContent(content: unknown): Uint8Array {
  return encoder.encode(canonicalize(content));
}

function withinBytes(content: unknown, max: number): boolean {
  const size = canonicalBytes(content);
  return size !== undefined && size <= max;
}

export const messageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(messagePartInputSchema).min(1),
});
export const messageContentSchema = z.object({
  schema_version: z.literal(1),
  parts: z.array(messagePartSchema).min(1),
});
type MessagePart = z.infer<typeof messagePartSchema>;

// block 배열을 저장하는 본문으로 옮긴다. 같은 block은 항상 같은 바이트다(옵션 칸이 없으면 칸을 두지 않는다).
// 받는 session 기록과 blob 준비가 같은 함수를 쓰므로 hash가 어긋나지 않는다.
export function contentOfBlocks(blocks: readonly ContentBlock[]) {
  return {
    schema_version: 1 as const,
    parts: blocks.map((block): MessagePart => {
      switch (block.type) {
        case "text":
          return { kind: "text", text: block.text };
        case "image":
          return { kind: "image", mime_type: block.mimeType, blob: block.blob };
        case "resource_link":
          return {
            kind: "resource_link",
            uri: block.uri,
            name: block.name,
            ...(block.mimeType === undefined
              ? {}
              : { mime_type: block.mimeType }),
            ...(block.description === undefined
              ? {}
              : { description: block.description }),
          };
        case "resource":
          return {
            kind: "resource",
            uri: block.uri,
            ...(block.mimeType === undefined
              ? {}
              : { mime_type: block.mimeType }),
            text: block.text,
          };
      }
    }),
  };
}

// 저장된 본문에서 block으로 돌린다. 카드와 reasoning은 block이 아니라 빠진다.
export function blocksOfContent(
  content: z.infer<typeof messageContentSchema>,
): ContentBlock[] {
  return content.parts.flatMap((part): ContentBlock[] => {
    switch (part.kind) {
      case "text":
        return [{ type: "text", text: part.text }];
      case "image":
        return [{ type: "image", mimeType: part.mime_type, blob: part.blob }];
      case "resource_link":
        return [
          {
            type: "resource_link",
            uri: part.uri,
            name: part.name,
            ...(part.mime_type === undefined
              ? {}
              : { mimeType: part.mime_type }),
            ...(part.description === undefined
              ? {}
              : { description: part.description }),
          },
        ];
      case "resource":
        return [
          {
            type: "resource",
            uri: part.uri,
            ...(part.mime_type === undefined
              ? {}
              : { mimeType: part.mime_type }),
            text: part.text,
          },
        ];
      default:
        return [];
    }
  });
}

// 사람 메시지는 block 배열이다. 본문 상한(64KiB)은 저장되는 본문의 정규 직렬화로 센다.
export const userContentBlocksSchema = contentBlocksSchema.refine(
  (blocks) =>
    withinBytes(contentOfBlocks(blocks), MESSAGE_TEXT_CONTENT_MAX_BYTES),
  { message: "message content is too large" },
);
// agent 답은 글과 앱 카드를 받는다.
export const agentMessageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(agentPartInputSchema).min(1),
});
// machine 답은 글과 reasoning을 받는다. byte 상한은 owner가 준비 전에 본다.
export const machineMessageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(machinePartInputSchema).min(1),
});

// 요청은 본문 값(MessageContent)을 싣는다. renderer·shell·runtime은 blob을 준비하지
// 않는다: core가 redaction을 거친 값을 blob으로 준비하고 command가 같은 transaction에서
// 영구 참조를 등록한다. ledger에는 그 blob의 hash만 남는다.
