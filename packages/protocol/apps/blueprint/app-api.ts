// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.

import {
  exactKeys,
  type InputSchema,
  invalid,
  isObject,
  nonBlank,
  type ScreenDeclaration,
  type ScreenSize,
  type ToolDeclaration,
  type ValidationResult,
} from "./types.ts";
import { unique } from "./json.ts";
import { validateSchemaNode } from "./schema.ts";
import { screenPath } from "./scope.ts";

// toolNameSchema(channel-values.ts)와 같은 규칙. MCP tool 이름 문자 집합이고, 길이는 agent tool 이름에 들어가도록 64다.
// 이 file은 의존성이 없어 따로 쓴다.
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

function blankDescription(schema: InputSchema): string | undefined {
  if (
    Object.hasOwn(schema, "description") && !nonBlank(schema.description)
  ) {
    return "description must be nonblank";
  }
  if (schema.properties) {
    for (const [name, property] of Object.entries(schema.properties)) {
      const blank = blankDescription(property);
      if (blank) return `properties.${name} ${blank}`;
    }
  }
  if (schema.items) {
    const blank = blankDescription(schema.items);
    if (blank) return `items ${blank}`;
  }
}

export function validateScreensAndTools(
  screenItems: unknown[],
  toolItems: unknown[],
): ValidationResult<{
  screens: ScreenDeclaration[];
  tools: ToolDeclaration[];
}> {
  const screens: ScreenDeclaration[] = [];
  for (const item of screenItems) {
    if (!isObject(item)) return invalid("screen must be an object");
    const bad = exactKeys(item, ["key", "label", "path", "sizes"], [
      "key",
      "label",
      "path",
      "sizes",
    ]);
    if (bad) return invalid(`screen ${bad}`);
    if (!nonBlank(item.key) || !nonBlank(item.label)) {
      return invalid("screen key and label must be nonblank");
    }
    if (screenPath(item.path)) return invalid(screenPath(item.path)!);
    if (!Array.isArray(item.sizes) || item.sizes.length === 0) {
      return invalid("screen sizes must be nonempty");
    }
    if (
      item.sizes.some((size) =>
        size !== "full" && size !== "panel" && size !== "card"
      )
    ) {
      return invalid("screen size is unsupported");
    }
    if (new Set(item.sizes).size !== item.sizes.length) {
      return invalid("screen sizes are duplicated");
    }
    screens.push({
      key: item.key,
      label: item.label,
      path: item.path as string,
      sizes: [...item.sizes] as ScreenSize[],
    });
  }
  if (unique(screens.map((screen) => screen.key), "screen")) {
    return invalid("duplicate screen");
  }

  const tools: ToolDeclaration[] = [];
  for (const item of toolItems) {
    if (!isObject(item)) return invalid("tool must be an object");
    const bad = exactKeys(item, [
      "description",
      "effect",
      "inputSchema",
      "name",
      "outputSchema",
      "public",
      "title",
    ], [
      "description",
      "effect",
      "inputSchema",
      "name",
      "public",
      "title",
    ]);
    if (bad) return invalid(`tool ${bad}`);
    if (typeof item.name !== "string" || !TOOL_NAME.test(item.name)) {
      return invalid(
        "tool name must be 1-64 characters of letters, digits, _ - .",
      );
    }
    if (!nonBlank(item.title) || !nonBlank(item.description)) {
      return invalid(
        `tool ${item.name} title and description must be nonblank`,
      );
    }
    if (
      item.effect !== "read" && item.effect !== "write" &&
      item.effect !== "external"
    ) {
      return invalid(`tool ${item.name} effect is unsupported`);
    }
    if (typeof item.public !== "boolean") {
      return invalid(`tool ${item.name} public must be boolean`);
    }
    const inputSchema = item.inputSchema === null
      ? ({ ok: true, value: null } as const)
      : objectSchema(item.inputSchema, `tool ${item.name} inputSchema`);
    if (!inputSchema.ok) return inputSchema;
    const tool: ToolDeclaration = {
      name: item.name,
      title: item.title,
      description: item.description,
      inputSchema: inputSchema.value,
      effect: item.effect,
      public: item.public,
    };
    if (Object.hasOwn(item, "outputSchema")) {
      const outputSchema = objectSchema(
        item.outputSchema,
        `tool ${item.name} outputSchema`,
      );
      if (!outputSchema.ok) return outputSchema;
      tool.outputSchema = outputSchema.value;
    }
    tools.push(tool);
  }
  if (unique(tools.map((tool) => tool.name), "tool")) {
    return invalid("duplicate tool");
  }

  return { ok: true, value: { screens, tools } };
}

function objectSchema(
  value: unknown,
  label: string,
): ValidationResult<InputSchema> {
  const parsed = validateSchemaNode(value, label);
  if (!parsed.ok) return parsed;
  if (parsed.value.type !== "object") {
    return invalid(`${label} root type must be object`);
  }
  const blank = blankDescription(parsed.value);
  if (blank) return invalid(`${label} ${blank}`);
  return parsed;
}

// MCP `tools/list`의 annotation과 항목. annotation은 힌트일 뿐이고 강제는 Gate와 runtime 권한이 한다.
export type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  openWorldHint: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema?: InputSchema;
  annotations: ToolAnnotations;
};

// tool이 지우는지 program이 알 수 없어 write·external의 destructiveHint는 MCP 기본값(true)을 따른다.
// read에서는 의미가 없어 뺀다.
export function toolAnnotations(
  tool: Pick<ToolDeclaration, "title" | "effect">,
): ToolAnnotations {
  if (tool.effect === "read") {
    return { title: tool.title, readOnlyHint: true, openWorldHint: false };
  }
  return {
    title: tool.title,
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: tool.effect === "external",
  };
}

// public·effect는 항목에 싣지 않는다(annotation만).
export function toMcpTool(tool: ToolDeclaration): McpTool {
  const mcp: McpTool = {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema ??
      { type: "object", properties: {}, additionalProperties: false },
    annotations: toolAnnotations(tool),
  };
  if (tool.outputSchema) mcp.outputSchema = tool.outputSchema;
  return mcp;
}
