import { z } from "zod";
import type { JsonValue } from "../../protocol/base/mod.ts";

// agent에게 넣는 글. 고정 영어 문장이다.
export function runMessageText({
  prompt,
  input,
  schema,
}: {
  prompt: string;
  input?: JsonValue | undefined;
  schema?: Record<string, JsonValue> | undefined;
}): string {
  const parts = [prompt];
  if (input !== undefined) {
    parts.push(`Input (JSON):\n${JSON.stringify(input, null, 2)}`);
  }
  if (schema !== undefined) {
    parts.push(
      "Reply with only one JSON value that matches this JSON Schema. Do not add any other text.\n" +
        JSON.stringify(schema, null, 2),
    );
  }
  return parts.join("\n\n");
}

// 글 전체가 code fence 하나면 그것만 벗기고 JSON으로 읽는다. 그 밖에는 글을 고치지 않는다.
export function readAnswer(
  text: string,
  schema: Record<string, JsonValue>,
): { ok: true; value: JsonValue } | { ok: false; message: string } {
  let body = text.trim();
  const lines = body.split("\n");
  if (
    lines.length >= 2 &&
    lines[0]!.startsWith("```") &&
    lines[lines.length - 1]!.trim() === "```"
  )
    body = lines.slice(1, -1).join("\n");
  let value: JsonValue;
  try {
    value = JSON.parse(body) as JsonValue;
  } catch {
    return { ok: false, message: "the answer is not JSON" };
  }
  const checked = z.fromJSONSchema(schema).safeParse(value);
  if (checked.success) return { ok: true, value };
  const why = checked.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, message: `the answer does not match the schema: ${why}` };
}
