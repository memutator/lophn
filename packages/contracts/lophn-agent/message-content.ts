import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { visualBlockInputSchema, visualBlockSchema } from "./visuals.ts";

export const MESSAGE_VISUAL_MAX_COUNT = 8;
export const MESSAGE_VISUAL_MAX_BYTES = 262144;
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

export const messageContentInputSchema = z.strictObject({
  schema_version: z.literal(1),
  parts: z.array(messagePartInputSchema).min(1),
}).refine((value) => validVisuals(value.parts), {
  message: "invalid visual keys, count or canonical bytes",
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

// ledger command body는 여전히 hash다. blob 변환과 actor 인증은 owner가 한다.
