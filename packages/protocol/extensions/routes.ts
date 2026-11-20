import { z } from "zod";
import { defineMemory, defineRead } from "../base/route.ts";
import { extensionContributesSchema } from "./manifest.ts";

// Settings › Extensions다. extension host는 core 안에서 돈다. 켜기·끄기는 이 route가 아니라 설정(`extensions.<id>.enabled`) 쓰기다.

export const extensionStatusSchema = z.enum([
  "off",
  "on",
  "invalid",
  "no_setting",
  "failed",
]);
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>;

// registry의 목록 한 줄.
export const extensionViewSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  status: extensionStatusSchema,
  // 문제가 있을 때 이유.
  reason: z.string().optional(),
  // 표시 file이 있다. 없으면 설치 안 됨이다.
  installed: z.boolean(),
  // 본체에 기본으로 늘 켜지는 내장 extension인가.
  builtin: z.boolean().optional(),
  // 켜진 extension의 기여(command·key). 꺼져 있으면 없다.
  contributes: extensionContributesSchema.optional(),
});
export type ExtensionView = z.infer<typeof extensionViewSchema>;

const idInput = z.strictObject({ id: z.string().min(1).max(80) });

// 목록을 읽기 전에 설정과 맞춰 두어 방금 바꾼 켜기·끄기가 보인다.
export const extensionsList = defineRead({
  resource: "extensions",
  method: "list",
  name: "ExtensionsList",
  input: z.strictObject({}),
  output: z.strictObject({ extensions: z.array(extensionViewSchema) }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

// 표시 file만 둔다(내려받기는 아직 없다). 이미 있으면 그대로다. 없는 id면 not_found다.
export const extensionsInstall = defineMemory({
  resource: "extensions",
  method: "install",
  name: "ExtensionsInstall",
  changes: [],
  input: idInput,
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// 표시 file에 적힌, extension이 쓴 file만 지운다. 켜져 있으면 conflict다.
export const extensionsRemove = defineMemory({
  resource: "extensions",
  method: "remove",
  name: "ExtensionsRemove",
  changes: [],
  input: idInput,
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "conflict"],
});

// `ext.<id>.<name>` command를 켜진 extension의 handler로 부른다. 없으면 not_found, handler가 던지면 internal이다.
export const extensionsRun = defineMemory({
  resource: "extensions",
  method: "run",
  name: "ExtensionsRun",
  changes: [],
  input: z.strictObject({ command: z.string().min(1).max(160) }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "internal",
  ],
});

export const EXTENSION_ROUTES = [
  extensionsList,
  extensionsInstall,
  extensionsRemove,
  extensionsRun,
] as const;
