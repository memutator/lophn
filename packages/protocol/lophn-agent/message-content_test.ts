import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "./content-block.ts";
import {
  blocksOfContent,
  contentOfBlocks,
  messageContentSchema,
  serializeMessageContent,
  userContentBlocksSchema,
} from "./message-content.ts";

// 접수만 하고 turn이 가져가지 않은 사람 메시지는 재시작 때 저장된 본문에서 queue로 돌아온다. 돌아온 block이 처음과
// 다르면 image가 다른 blob을 가리키거나 사라지고, 본문 hash가 달라져 받은 turn과 이력이 갈린다.
test("저장된 본문을 읽어 되돌린 block은 보낸 block과 같고 같은 bytes로 다시 저장된다", () => {
  const blocks: ContentBlock[] = [
    { type: "text", text: "look" },
    { type: "image", mimeType: "image/webp", blob: "c".repeat(64) },
    { type: "resource_link", uri: "file:///a", name: "a" },
    {
      type: "resource_link",
      uri: "file:///b",
      name: "b",
      mimeType: "text/plain",
      description: "notes",
    },
    { type: "resource", uri: "file:///c", text: "body" },
  ];
  assert.ok(userContentBlocksSchema.safeParse(blocks).success);
  const stored = serializeMessageContent(contentOfBlocks(blocks));
  const read = messageContentSchema.parse(
    JSON.parse(new TextDecoder().decode(stored)),
  );
  const back = blocksOfContent(read);
  assert.deepStrictEqual(back, blocks);
  assert.deepStrictEqual(
    serializeMessageContent(contentOfBlocks(back)),
    stored,
  );
});
