// project 등록·수정·보관·조회 계약. 옛 `project-routes.ts`와 route 이름이 같아서 `projectApi` 객체에 담는다.
import { z } from "zod";
import {
  iconReadOutputSchema,
  iconSetOutputSchema,
  iconSetSchema,
} from "../base/icon.ts";
import { archiveStateSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import {
  projectFolderReadSchema,
  projectFoldersSchema,
} from "./project-folders.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  revisionSchema,
  slugSchema,
} from "./values.ts";

// slug name은 call의 `workspace: {project: 이름}`이 맞춰 쓰는 key이고 title은 사람에게 보이는 이름이다.
export const projectRecordSchema = z.object({
  id: projectIdSchema,
  name: slugSchema,
  title: z.string().min(1),
  purpose: z.string(),
  revision: revisionSchema,
  status: archiveStateSchema,
  folders: z.array(projectFolderReadSchema),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

const projectRegisterInputSchema = z.strictObject({
  id: projectIdSchema,
  name: slugSchema,
  title: z.string().min(1),
  purpose: z.string(),
  folders: projectFoldersSchema,
});
const editFields = {
  name: slugSchema.optional(),
  title: z.string().min(1).optional(),
  purpose: z.string().optional(),
  folders: projectFoldersSchema.optional(),
};
const projectEditInputSchema = z
  .strictObject({
    project: projectIdSchema,
    ...editFields,
  })
  .refine(
    (value) =>
      Object.keys(editFields).some(
        (field) => value[field as keyof typeof editFields] !== undefined,
      ),
    { message: "edit must change at least one field" },
  );
const projectRefInputSchema = z.strictObject({
  project: projectIdSchema,
});
// 찾을 수 없게 된 등록 폴더를 사람이 새 위치로 이어 준다.
const projectRelinkFolderInputSchema = z.strictObject({
  project: projectIdSchema,
  folder_path: absolutePathSchema,
  new_path: absolutePathSchema,
});
const projectBaseRevisionSchema = z.strictObject({
  base_revision: revisionSchema,
});

const writeErrors = [
  "invalid_input",
  "not_found",
  "conflict",
  "forbidden",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;
const readers = ["user", "agent", "app"] as const;

export const projectApi = {
  register: defineCommand({
    resource: "projects",
    method: "create",
    name: "project.create",
    input: projectRegisterInputSchema,
    output: projectRecordSchema,
    compare: z.strictObject({}),
    actors: ["user"],
    errors: ["invalid_input", "conflict", "forbidden"],
  }),
  edit: defineCommand({
    resource: "projects",
    method: "update",
    name: "project.update",
    input: projectEditInputSchema,
    output: projectRecordSchema,
    compare: projectBaseRevisionSchema,
    actors: ["user"],
    errors: writeErrors,
  }),
  relinkFolder: defineCommand({
    resource: "projects",
    method: "relink_folder",
    name: "project.relink_folder",
    input: projectRelinkFolderInputSchema,
    output: projectRecordSchema,
    compare: projectBaseRevisionSchema,
    actors: ["user"],
    errors: writeErrors,
  }),
  archive: defineCommand({
    resource: "projects",
    method: "archive",
    name: "project.archive",
    input: projectRefInputSchema,
    output: projectRecordSchema,
    compare: projectBaseRevisionSchema,
    actors: ["user"],
    errors: ["not_found", "conflict", "forbidden"],
  }),
  unarchive: defineCommand({
    resource: "projects",
    method: "unarchive",
    name: "project.unarchive",
    input: projectRefInputSchema,
    output: projectRecordSchema,
    compare: projectBaseRevisionSchema,
    actors: ["user"],
    errors: ["not_found", "conflict", "forbidden"],
  }),
  // 사람이 올린 icon을 정하거나(icon) 지운다(null). revision을 올리지 않는다.
  setIcon: defineCommand({
    resource: "projects",
    method: "set_icon",
    name: "project.set_icon",
    input: z.strictObject({ project: projectIdSchema, icon: iconSetSchema }),
    output: iconSetOutputSchema,
    actors: ["user"],
    errors: ["invalid_input", "not_found"],
  }),
  // 올린 icon이 없으면 icon이 null이다(오류가 아니다. project는 첫 글자 표식으로 보인다).
  icon: defineRead({
    resource: "projects",
    method: "icon",
    name: "project.icon",
    input: projectRefInputSchema,
    // ledger read는 as_of_seq를 붙여 read 공통 모양으로 검사한다(app.icon은 API read라 감싸지 않는다).
    output: withReadCommon(iconReadOutputSchema),
    actors: ["user"],
    errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
  }),
  list: defineRead({
    resource: "projects",
    method: "list",
    name: "project.list",
    input: z.strictObject({
      status: archiveStateSchema.optional(),
      cursor: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    }),
    output: withReadCommon(
      z.object({ projects: z.array(projectRecordSchema) }),
    ),
    actors: readers,
    errors: [
      "invalid_input",
      "unauthorized",
      "forbidden",
      "conflict",
      "unavailable",
    ],
  }),
  get: defineRead({
    resource: "projects",
    method: "get",
    name: "project.get",
    input: projectRefInputSchema,
    output: withReadCommon(z.object({ project: projectRecordSchema })),
    actors: readers,
    errors: [
      "invalid_input",
      "unauthorized",
      "forbidden",
      "not_found",
      "unavailable",
    ],
  }),
  resolve: defineRead({
    resource: "projects",
    method: "resolve",
    name: "project.resolve",
    input: z.strictObject({ path: absolutePathSchema }),
    output: withReadCommon(
      z.object({
        project: projectRecordSchema,
        folder_path: absolutePathSchema,
      }),
    ),
    actors: ["user"],
    errors: readErrors,
  }),
} as const;

export const PROJECT_API_ROUTES = [
  projectApi.register,
  projectApi.edit,
  projectApi.relinkFolder,
  projectApi.archive,
  projectApi.unarchive,
  projectApi.setIcon,
  projectApi.icon,
  projectApi.list,
  projectApi.get,
  projectApi.resolve,
] as const;
