import { z } from "zod";
import { idSchema } from "../../../../protocol/base/ids.ts";
import {
  type InputSchema,
  validateInput,
} from "../../../../protocol/apps/mod.ts";
import type { Place } from "../../../../protocol/lophn-agent/places.ts";

// app-api tool의 입력이다. 입력이 object인 app-api는 그 입력이 tool 입력이고, 입력이 없으면 빈 object,
// 그 밖의 종류는 `{input}` 하나로 감싼다(model의 tool 입력은 object여야 한다).
//
// project 범위 app-api는 project를 부르는 쪽이 정한다(S5 4장). project에 놓인 agent의 입력에는 `project`
// 칸이 없고 보내면 거절된다(core가 그 agent의 project를 넣는다). lophn과 앱 place의 agent는 `project`
// 칸을 보이고, 이 칸은 앱에 가는 입력이 아니라 호출의 project다.

type AppApiInputDeclaration = {
  input: InputSchema | null;
  project_scope: boolean;
};

type AppApiInput = {
  jsonSchema: Record<string, unknown>;
  // 값을 바꾸지 않는다. 틀리면 issue를 낸다.
  validator: z.ZodType;
  // 검사를 통과한 tool 입력을 호출에 싣는 두 값으로 나눈다. input이 undefined이면 보내지 않는다.
  split(value: unknown): { input: unknown; project: string | null };
};

const PROJECT = "project";
const PROJECT_SCHEMA = idSchema("prj");

const NO_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function appApiInput(
  api: AppApiInputDeclaration,
  place: Place | null,
): AppApiInput {
  const schema = api.input;
  const wrapped = schema !== null && schema.type !== "object";
  // 이 agent가 project를 정해야 하는가. project에 놓인 agent는 core가 정한다.
  const picks = api.project_scope && place?.kind !== "project";
  const reserved = api.project_scope && !picks;

  const base: Record<string, unknown> = schema === null
    ? { ...NO_INPUT }
    : wrapped
    ? {
      type: "object",
      properties: { input: schema },
      required: ["input"],
      additionalProperties: false,
    }
    : { ...schema };
  const jsonSchema = picks
    ? {
      ...base,
      properties: {
        ...(base.properties as object | undefined),
        [PROJECT]: {
          type: "string",
          description: "the project this call is for",
        },
      },
      required: [...(base.required as string[] | undefined ?? []), PROJECT],
    }
    : base;

  // project 칸을 뺀 나머지다.
  function rest(value: Record<string, unknown>): Record<string, unknown> {
    const { [PROJECT]: _project, ...others } = value;
    return others;
  }

  const validator = z.unknown().superRefine((value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (!plainObject(value)) return fail("input must be an object");
    if (reserved && Object.hasOwn(value, PROJECT)) {
      return fail("project is set by the agent's place");
    }
    let body: Record<string, unknown> = value;
    if (picks) {
      if (!PROJECT_SCHEMA.safeParse(value[PROJECT]).success) {
        return fail("project must be a project id");
      }
      body = rest(value);
    }
    if (schema === null) {
      if (Object.keys(body).length > 0) fail("this app-api takes no input");
      return;
    }
    if (wrapped) {
      if (Object.keys(body).join() !== "input") {
        return fail("input must be { input }");
      }
      const checked = validateInput(schema, body.input);
      if (!checked.ok) fail(checked.error.message);
      return;
    }
    const checked = validateInput(schema, body);
    if (!checked.ok) fail(checked.error.message);
  });

  return {
    jsonSchema,
    validator,
    split(value) {
      const object = value as Record<string, unknown>;
      const project = picks ? object[PROJECT] as string : null;
      const body = picks ? rest(object) : object;
      if (schema === null) return { input: undefined, project };
      return { input: wrapped ? body.input : body, project };
    },
  };
}
