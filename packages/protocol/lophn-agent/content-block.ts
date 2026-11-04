import { z } from "zod";
import { sha256Schema } from "../base/values.ts";
import { messageImageTypeSchema } from "./message-images.ts";

// call 본문과 답, 사람 메시지가 오가는 단위다. MCP ContentBlock 꼴을 빌린다. 이미지는 bytes 대신 blob hash를
// 갖는다: 본문 상한(240 KiB)에 이미지가 안 들어가서이고, runtime이 model에 보낼 때 bytes를 읽는다.
export const contentBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({
    type: z.literal("image"),
    mimeType: messageImageTypeSchema,
    blob: sha256Schema,
  }),
  z.strictObject({
    type: z.literal("resource_link"),
    uri: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("resource"),
    uri: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    text: z.string(),
  }),
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const contentBlocksSchema = z.array(contentBlockSchema).min(1);

export function textBlocks(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

// 이미지를 글로만 적어야 하는 곳(자동 제목, Compact 요약 재료)이 이미지 자리에 놓는 고정 글이다.
export const IMAGE_NOTE = "[image]";

// 글 block만 이어 붙인 글이다. 화면 event의 글 칸이 쓴다.
export function blocksText(blocks: readonly ContentBlock[]): string {
  return blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

// 글 block과 이미지 자리의 고정 글을 이어 붙인 글이다. 자동 제목이 쓴다.
export function blocksSummary(blocks: readonly ContentBlock[]): string {
  return blocks
    .flatMap((block) =>
      block.type === "text"
        ? [block.text]
        : block.type === "image"
          ? [IMAGE_NOTE]
          : [],
    )
    .join("\n");
}
