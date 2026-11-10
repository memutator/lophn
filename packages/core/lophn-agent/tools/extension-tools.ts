import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import {
  extensionToolModelName,
  type ExtensionToolContent,
} from "../../../protocol/extensions/manifest.ts";
import {
  extensionToolsCall,
  type PublishedExtension,
} from "../../../protocol/lophn-agent/extension-tools.ts";
import { WIRE_TOOL_NAME_PATTERN } from "../../../protocol/lophn-agent/tool-catalog.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import { readOf } from "../run-loop/core-call.ts";
import { limitJson } from "./result.ts";
import type { ToolDefinition } from "./registry.ts";

// shell extension이 manifest로 선언한 tool의 정의다. 사람이 정의 `extensions`로 할당한 extension의 tool 전부를 싣고(custom은
// `tools`가 고른 이름만 prepare가 거른다), 실행은 `extension_tools/call` 한 곳으로 간다: Gate 판정, host queue, shell main의
// handler는 그 route가 한다. 그래서 정의에는 `gate`를 두지 않는다. 할당이 곧 허락이라 결과를 감싸지 않는다.
const OBJECT_INPUT: z.ZodType = z.unknown().superRefine((value, context) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    context.addIssue({
      code: "custom",
      message: "tool input must be an object",
    });
  }
});

// 결과 조각을 tool 결과로 옮긴다. 이미지가 결과의 전부이면 `image.read`와 같은 꼴로 싣고, 글과 섞이면 이미지는 뺀다.
function resultOf(
  name: string,
  content: readonly ExtensionToolContent[],
): ToolResult {
  const image = content.length === 1 ? content[0] : undefined;
  if (image?.type === "image") {
    return {
      status: "success",
      summary: `tool ${name} returned an image`,
      content: {
        image: { media_type: image.mimeType, data_base64: image.data },
      },
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    };
  }
  const text = content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
  const dropped = content.length - text.length;
  const limited = limitJson(text.join("\n"));
  return {
    status: "success",
    summary: `tool ${name} finished${dropped > 0 ? " (images were not included)" : ""}`,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function buildExtensionTools(
  catalog: readonly PublishedExtension[],
  assigned: readonly string[],
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const seen = new Set<string>();
  for (const extension of catalog) {
    if (!assigned.includes(extension.id)) continue;
    for (const tool of extension.tools) {
      const name = extensionToolModelName(extension.id, tool.name);
      // 이름 하나가 목록 전체를 깬다(wire.ts). 맞지 않거나 겹치면 그 tool만 뺀다.
      if (!WIRE_TOOL_NAME_PATTERN.test(name) || seen.has(name)) continue;
      seen.add(name);
      tools.push({
        name,
        description: tool.description,
        input: OBJECT_INPUT,
        inputSchema: tool.inputSchema,
        effect: tool.effect,
        origin: "extension",
        handler: async (input, ctx) => {
          const called = await readOf(ctx.core, extensionToolsCall, {
            name,
            input,
          });
          return called.ok
            ? ok(resultOf(name, called.value.content))
            : err(called.error);
        },
        operations: [extensionToolsCall.name],
      });
    }
  }
  return tools;
}
