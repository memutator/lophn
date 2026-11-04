import type { ContentBlock } from "./acp-types.ts";

/** 앱 화면의 context(보고 있는 글, 고른 항목)를 agent에게 보낼 `resource` block으로 싼다. */
export function contextBlock(input: {
  name: string;
  mimeType: string;
  text: string;
}): ContentBlock {
  return {
    type: "resource",
    uri: `app-context:${encodeURIComponent(input.name)}`,
    mimeType: input.mimeType,
    text: input.text,
  };
}
