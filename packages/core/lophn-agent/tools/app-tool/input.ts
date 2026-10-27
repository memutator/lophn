import { z } from "zod";
import {
  type InputSchema,
  validateInput,
} from "../../../../protocol/apps/mod.ts";

// tool의 입력이다. 선언의 inputSchema는 null(인자 없음)이거나 root가 object라 그대로 tool 입력이 된다.
// null이면 빈 object만 받고 앱에는 입력을 보내지 않는다.

const NO_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export function toolInput(schema: InputSchema | null): {
  jsonSchema: Record<string, unknown>;
  // 값을 바꾸지 않는다. 틀리면 issue를 낸다.
  validator: z.ZodType;
} {
  const validator = z.unknown().superRefine((value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return fail("input must be an object");
    if (schema === null) {
      if (Object.keys(value).length > 0) fail("this tool takes no input");
      return;
    }
    const checked = validateInput(schema, value);
    if (!checked.ok) fail(checked.error.message);
  });
  return {
    jsonSchema: schema === null ? { ...NO_INPUT } : { ...schema },
    validator,
  };
}
