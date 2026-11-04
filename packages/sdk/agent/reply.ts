import type { ContentBlock } from "./acp-types.ts";

// agent의 답을 값으로 받는 데 필요한 만큼의 JSON schema다. 이 밖의 키워드는 보지 않고 넘어간다.
export type JsonSchema = {
  type?:
    | "object"
    | "array"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null";
  properties?: { readonly [key: string]: JsonSchema };
  required?: readonly string[];
  items?: JsonSchema;
  enum?: readonly unknown[];
};

export type Reply<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matches(type: string, value: unknown): boolean {
  if (type === "integer") return Number.isInteger(value);
  return typeOf(value) === type;
}

// 첫 어긋남의 자리와 이유를 글로 낸다. 맞으면 null이다.
function mismatch(
  schema: JsonSchema,
  value: unknown,
  path: string,
): string | null {
  if (schema.type !== undefined && !matches(schema.type, value)) {
    return `${path}: expected ${schema.type}, got ${typeOf(value)}`;
  }
  if (
    schema.enum !== undefined &&
    !schema.enum.some((one) => JSON.stringify(one) === JSON.stringify(value))
  ) {
    return `${path}: not one of ${JSON.stringify(schema.enum)}`;
  }
  if (typeOf(value) === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) return `${path}.${key}: required`;
    }
    for (const [key, inner] of Object.entries(schema.properties ?? {})) {
      if (!(key in object)) continue;
      const found = mismatch(inner, object[key], `${path}.${key}`);
      if (found !== null) return found;
    }
  }
  if (schema.items !== undefined && Array.isArray(value)) {
    for (const [at, one] of value.entries()) {
      const found = mismatch(schema.items, one, `${path}[${at}]`);
      if (found !== null) return found;
    }
  }
  return null;
}

/** agent 글에서 JSON을 꺼내 schema에 맞춘다. 마지막 ```json 블록이 있으면 그것이고, 없으면 글 전체가 JSON이다. */
export function parseReply(text: string, schema: JsonSchema): Reply {
  const fenced = [...text.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)```/g)];
  const source = fenced.at(-1)?.[1] ?? text;
  let value: unknown;
  try {
    value = JSON.parse(source.trim());
  } catch {
    return { ok: false, error: "reply is not JSON" };
  }
  const found = mismatch(schema, value, "$");
  return found === null
    ? { ok: true, value }
    : { ok: false, error: `reply does not fit the shape: ${found}` };
}

/** 답의 꼴을 알리는 글 block. send가 사람의 block 뒤에 붙인다. */
export function replyInstruction(schema: JsonSchema): ContentBlock {
  return {
    type: "text",
    text: `Reply with one JSON value in a \`\`\`json fenced block and nothing else. It must fit this JSON schema:\n${JSON.stringify(schema)}`,
  };
}
