import { z } from "zod";
import {
  type InputSchema,
  validateInput,
} from "../../../../protocol/apps/mod.ts";

// app-api tool의 입력이다. 입력이 object인 app-api는 그 입력이 tool 입력이고, 입력이 없으면 빈 object,
// 그 밖의 종류는 `{input}` 하나로 감싼다(model의 tool 입력은 object여야 한다).

type AppApiInput = {
  jsonSchema: Record<string, unknown>;
  // 값을 바꾸지 않는다. 틀리면 issue를 낸다.
  validator: z.ZodType;
  // 검사를 통과한 tool 입력에서 호출에 싣는 값을 꺼낸다. undefined이면 보내지 않는다.
  split(value: unknown): { input: unknown };
};

const NO_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function appApiInput(schema: InputSchema | null): AppApiInput {
  const wrapped = schema !== null && schema.type !== "object";

  const jsonSchema: Record<string, unknown> = schema === null
    ? { ...NO_INPUT }
    : wrapped
    ? {
      type: "object",
      properties: { input: schema },
      required: ["input"],
      additionalProperties: false,
    }
    : { ...schema };

  const validator = z.unknown().superRefine((value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (!plainObject(value)) return fail("input must be an object");
    if (schema === null) {
      if (Object.keys(value).length > 0) fail("this app-api takes no input");
      return;
    }
    if (wrapped) {
      if (Object.keys(value).join() !== "input") {
        return fail("input must be { input }");
      }
      const checked = validateInput(schema, value.input);
      if (!checked.ok) fail(checked.error.message);
      return;
    }
    const checked = validateInput(schema, value);
    if (!checked.ok) fail(checked.error.message);
  });

  return {
    jsonSchema,
    validator,
    split(value) {
      const object = value as Record<string, unknown>;
      if (schema === null) return { input: undefined };
      return { input: wrapped ? object.input : object };
    },
  };
}
