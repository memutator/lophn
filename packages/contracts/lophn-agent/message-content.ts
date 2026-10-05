import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { visualBlockInputSchema, visualBlockSchema } from "./visuals.ts";

export const MESSAGE_VISUAL_MAX_COUNT = 8;
export const MESSAGE_VISUAL_MAX_BYTES = 262144;
// 본문 blob 하나의 정규 직렬화 상한이다. 요청은 본문 값을 싣고 RPC JSON 상한이 256KiB
// 이므로(platform/api) id·links 여유가 요청 상한 안에 남도록, 사람 말과 machine 확인은
// 글뿐이라 64KiB, agent 답은 글과 시각 블록을 합쳐 240KiB다.
export const MESSAGE_TEXT_CONTENT_MAX_BYTES = 65536;
export const MESSAGE_CONTENT_MAX_BYTES = 245760;
// 본문 blob 준비·참조의 이름. 준비 주체는 보낸 사람의 자격이고 참조는 permanent다.
export const MESSAGE_CONTENT_PURPOSE = "message_content";
export const MESSAGE_BODY_OWNER_KIND = "message";
export const MESSAGE_BODY_FIELD = "body";
const encoder = new TextEncoder();

export const messagePartInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({ kind: z.literal("visual"), block: visualBlockInputSchema }),
]);
export const messagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("visual"), block: visualBlockSchema }),
]);

function canonicalBytes(block: unknown): number | undefined {
  try {
    return encoder.encode(canonicalize(block)).length;
  } catch {
    return undefined;
  }
}

function validVisuals(parts: readonly z.infer<typeof messagePartSchema>[]) {
  const blocks = parts.flatMap((part) =>
    part.kind === "visual" ? [part.block] : []
  );
  if (
    blocks.length > MESSAGE_VISUAL_MAX_COUNT ||
    new Set(blocks.map((block) => block.key)).size !== blocks.length
  ) return false;
  let bytes = 0;
  for (const block of blocks) {
    const size = canonicalBytes(block);
    if (size === undefined) return false;
    bytes += size;
  }
  return bytes <= MESSAGE_VISUAL_MAX_BYTES;
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
}).refine((value) => validVisuals(value.parts), {
  message: "invalid visual keys, count or canonical bytes",
}).refine((value) => withinBytes(value, MESSAGE_CONTENT_MAX_BYTES), {
  message: "message content is too large",
});
export const messageContentSchema = z.object({
  schema_version: z.literal(1),
  parts: z.array(messagePartSchema).min(1),
}).refine((value) => validVisuals(value.parts), {
  message: "invalid visual keys, count or canonical bytes",
});

const textPartInput = z.strictObject({
  kind: z.literal("text"),
  text: z.string(),
});
const textPart = z.object({ kind: z.literal("text"), text: z.string() });

export const textMessageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(textPartInput).min(1),
}).refine((value) => withinBytes(value, MESSAGE_TEXT_CONTENT_MAX_BYTES), {
  message: "message text is too large",
});
export const textMessageContentSchema = z.object({
  schema_version: z.literal(1),
  parts: z.array(textPart).min(1),
});

export const userMessageContentInputSchema = textMessageContentInputSchema;
export const machineMessageContentInputSchema = textMessageContentInputSchema;
export const agentMessageContentInputSchema = messageContentInputSchema;

export type MessagePart = z.infer<typeof messagePartSchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;

// 요청은 본문 값(MessageContent)을 싣는다. renderer·shell·runtime은 blob을 준비하지
// 않는다: core가 redaction을 거친 값을 blob으로 준비하고 command가 같은 transaction에서
// 영구 참조를 등록한다(lophn-agent Q29). ledger에는 그 blob의 hash만 남는다.
