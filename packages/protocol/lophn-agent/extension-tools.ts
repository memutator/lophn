import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import {
  EXTENSION_ID,
  extensionToolContentSchema,
  extensionToolSchema,
} from "../extensions/manifest.ts";

// shell extension이 manifest `contributes.tools`로 선언한 tool의 core 쪽이다. core는 manifest를 읽지 못해서 shell main이
// 판이 맞는 manifest의 tool을 `publish`로 올리고(sync마다, core에 다시 붙을 때마다 통째로), core는 메모리에만 둔다.
// 다시 뜨면 비어 있고 shell이 다시 올린다. `catalog`는 설정 `extensions.<id>.enabled`가 켜진 것만 낸다.
// `call`은 lophn runtime과 harness CLI가 같이 거치는 한 곳이다: Gate `extension_tool`을 판정하고 host queue의 `tool_call`로
// shell main의 handler를 부른다.

// `ext__<extension id>__<tool>` 꼴인지 본다(정의의 `tools` 고르기를 저장할 때). 어느 extension에 그 tool이 있는지는 보지 않는다:
// extension은 나중에 켜고 끄고 바뀐다. 호출은 이름을 parse하지 않고 catalog 표로 찾는다.
export function parseExtensionToolName(
  name: string,
): { extension: string; tool: string } | null {
  const match = /^ext__([a-z][a-z0-9-]*)__([a-z][a-z0-9_]*)$/.exec(name);
  return match === null || match[2]!.includes("__")
    ? null
    : { extension: match[1]!, tool: match[2]! };
}

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "unavailable",
  "unauthorized",
  "internal",
] as const;

export const publishedExtensionSchema = z.strictObject({
  id: z.string().regex(EXTENSION_ID).max(64),
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  tools: z.array(extensionToolSchema).max(64),
});
export type PublishedExtension = z.infer<typeof publishedExtensionSchema>;

const catalogSchema = z.strictObject({
  extensions: z.array(publishedExtensionSchema).max(64),
});

// shell main이 켜진 것과 꺼진 것 상관없이 판이 맞는 manifest의 `{id, name, description, tools}` 전부를 통째로 바꾼다.
export const extensionToolsPublish = defineMemory({
  resource: "extension_tools",
  method: "publish",
  name: "PublishExtensionTools",
  changes: [],
  input: catalogSchema,
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// 켜진 extension의 tool 목록이다. 아직 올리지 않았으면 비어 있다.
export const extensionToolsCatalog = defineMemory({
  resource: "extension_tools",
  method: "catalog",
  name: "ListExtensionTools",
  input: z.strictObject({}),
  output: catalogSchema,
  actors: ["user", "machine"],
  errors,
});

// `name`은 model에 보이는 이름(`ext__<extension id>__<tool>`)이다. 부른 session의 agent 정의 `extensions`와 catalog로 Gate가
// 판정하고 `deny`면 `forbidden`, shell이 붙어 있지 않으면 `unavailable`이다. 결과는 감싸지 않는다.
export const extensionToolsCall = defineMemory({
  resource: "extension_tools",
  method: "call",
  name: "CallExtensionTool",
  changes: [],
  input: z.strictObject({ name: z.string().min(1).max(200), input: z.json() }),
  output: z.strictObject({
    content: z.array(extensionToolContentSchema).max(64),
  }),
  actors: ["agent"],
  errors,
});

export const EXTENSION_TOOL_ROUTES = [
  extensionToolsPublish,
  extensionToolsCatalog,
  extensionToolsCall,
] as const;
