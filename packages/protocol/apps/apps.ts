import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { archiveStateSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { definePort } from "../base/ports.ts";
import { iconSetOutputSchema, iconSetSchema } from "../base/icon.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  absolutePathSchema,
  appIdSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
} from "../projects/values.ts";
import {
  projectFolderOutputSchema,
  projectFoldersSchema,
} from "../projects/project-folders.ts";

export const releaseIdSchema = idSchema("rel");

// 화면 이름. 입력한 이름을 보존하므로 slug 문법을 강제하지 않는다.
const appNameSchema = z.string().min(1);
// 한 줄 목적. 빈 문자열과 줄바꿈은 금지다.
const appDescriptionSchema = z
  .string()
  .min(1)
  .refine((value) => !/[\r\n]/.test(value), {
    message: "description must be a single line",
  });

// documents가 자리 해석에서 부르는 존재·status·slug. runtime 상태는 없다.
const appRegistrationSchema = z.object({
  id: appIdSchema,
  slug: slugSchema,
  status: archiveStateSchema,
});
export type AppRegistration = z.infer<typeof appRegistrationSchema>;

// Tx.port 또는 ReadSnapshot.port가 같은 transaction·snapshot의 구현을 주입한다.
// archived도 돌려주므로 호출한 concern이 필요한 status를 검사한다.
interface AppRegistrationLookup {
  get(app: z.infer<typeof appIdSchema>): Result<AppRegistration | null>;
}

export const appRegistrationLookup = definePort<AppRegistrationLookup>(
  "apps.AppRegistrationLookup",
);

// app.delete가 같은 Tx에서 다른 module이 가진 앱 workspace의 기록(대화, job, 공유 요청, agent 할당)을 지우는 길이다.
// core/main이 끼운다. 끼우지 않으면 app.delete는 internal로 거절한다.
interface AppRemnantsEraser {
  erase(app: { id: string; slug: string }): Result<{ sessions: string[] }>;
}

export const appRemnantsEraser = definePort<AppRemnantsEraser>(
  "apps.AppRemnantsEraser",
);

const appFields = {
  id: appIdSchema,
  slug: slugSchema,
  name: appNameSchema,
  description: appDescriptionSchema,
  planning_version: versionIdSchema.nullable(),
  source_path: absolutePathSchema.nullable(),
  // source 밖에 사람이 더 이은 폴더. project 연결 폴더와 같은 모양이고 app workspace의 file 범위에 들어간다.
  folders: z.array(projectFolderOutputSchema),
  active_release: releaseIdSchema.nullable(),
  // App의 마지막 변경 seq이며 read snapshot 전체의 as_of_seq와 다르다.
  revision: revisionSchema,
  run_enabled: z.boolean(),
  status: archiveStateSchema,
};
export const appSchema = z
  .object(appFields)
  .refine((value) => value.status !== "archived" || !value.run_enabled, {
    message: "archived app cannot enable execution",
  });
export type App = z.infer<typeof appSchema>;

export const appCompareSchema = z.strictObject({
  base_revision: revisionSchema,
});

const appCreateInputSchema = z.strictObject({
  // 미리 배정한 app ID. 다른 기계의 앱을 같은 id로 들이는 core 안 폴더 take-in(machine)만 쓴다.
  // 없으면 등록이 ID를 만든다.
  id: appIdSchema.optional(),
  slug: slugSchema,
  name: appNameSchema,
  description: appDescriptionSchema,
  planning_version: versionIdSchema.optional(),
});
const appConnectSourceInputSchema = z.strictObject({
  app: appIdSchema,
  source_path: absolutePathSchema,
});
export const appInputSchema = z.strictObject({ app: appIdSchema });

// 등록은 user와 agent, 그리고 다른 기계의 앱을 들이는 core 안 폴더 take-in(machine)만 받는다.
export const appCreate = defineCommand({
  resource: "apps",
  method: "create",
  name: "app.create",
  changes: [{ name: "apps", id: (_input, output) => output.id }],
  input: appCreateInputSchema,
  output: appSchema,
  compare: z.strictObject({}),
  actors: ["user", "agent", "machine"],
  errors: ["forbidden", "invalid_input", "not_found", "conflict"],
});
// source 연결은 user, 그 앱 workspace의 agent, core가 새 앱의 source를 이을 때 machine만 받는다.
export const appConnectSource = defineCommand({
  resource: "apps",
  method: "connect_source",
  name: "app.connect_source",
  changes: [{ name: "apps", id: (_input, output) => output.id }],
  input: appConnectSourceInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user", "agent", "machine"],
  errors: ["forbidden", "invalid_input", "conflict", "not_found"],
});
export const appArchive = defineCommand({
  resource: "apps",
  method: "archive",
  name: "app.archive",
  changes: [
    { name: "apps", id: (_input, output) => output.id },
    { name: "app_runtime", id: (_input, output) => output.id },
  ],
  input: appInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "not_found"],
});
export const appUnarchive = defineCommand({
  resource: "apps",
  method: "unarchive",
  name: "app.unarchive",
  changes: [
    { name: "apps", id: (_input, output) => output.id },
    { name: "app_runtime", id: (_input, output) => output.id },
  ],
  input: appInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "not_found"],
});
// 보관한 앱을 영구히 지운다. 앱 source 폴더, 데이터, 대화, release와 기록이 함께 사라지고 되돌릴 수 없다. 사람만 한다.
// sessions는 같은 transaction에서 지운 그 앱 workspace의 session id다(commit 뒤 디스크 정리가 쓴다).
export const appDelete = defineCommand({
  resource: "apps",
  method: "delete",
  name: "app.delete",
  changes: [
    { name: "apps", id: (_input, output) => output.id },
    "sessions",
    "agents",
    "jobs",
    "share_requests",
  ],
  input: appInputSchema,
  output: z.object({
    id: appIdSchema,
    slug: slugSchema,
    sessions: z.array(z.string().min(1)),
  }),
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "forbidden", "not_found", "unavailable"],
});
const appRenameInputSchema = z.strictObject({
  app: appIdSchema,
  name: appNameSchema,
});
export const appRename = defineCommand({
  resource: "apps",
  method: "rename",
  name: "app.rename",
  changes: [{ name: "apps", id: (_input, output) => output.id }],
  input: appRenameInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "invalid_input", "not_found"],
});
// 더한 폴더 목록을 통째로 바꾼다. 사람만 한다.
const appEditFoldersInputSchema = z.strictObject({
  app: appIdSchema,
  folders: projectFoldersSchema,
});
export const appEditFolders = defineCommand({
  resource: "apps",
  method: "edit_folders",
  name: "app.edit_folders",
  changes: [{ name: "apps", id: (_input, output) => output.id }],
  input: appEditFoldersInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "invalid_input", "not_found"],
});
// 사람이 올린 icon을 정하거나(icon) 지운다(null). 앱 선언의 icon보다 앞선다. revision을 올리지 않는다.
export const appSetIcon = defineCommand({
  resource: "apps",
  method: "set_icon",
  name: "app.set_icon",
  changes: [{ name: "apps", id: (input) => input.app }],
  input: z.strictObject({ app: appIdSchema, icon: iconSetSchema }),
  output: iconSetOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found"],
});

const appListInputSchema = z.strictObject({
  status: archiveStateSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
});
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
// machine은 agent runtime이 앱 목록을 읽는다.
const readActors = ["user", "agent", "app", "machine"] as const;
export const appList = defineRead({
  resource: "apps",
  method: "list",
  name: "app.list",
  input: appListInputSchema,
  output: withReadCommon(z.object({ apps: z.array(appSchema) })),
  reads: ["apps"],
  actors: readActors,
  errors: readErrors,
});
export const appGet = defineRead({
  resource: "apps",
  method: "get",
  name: "app.get",
  input: appInputSchema,
  output: withReadCommon(z.object({ app: appSchema })),
  reads: [{ name: "apps", id: (input) => input.app }],
  actors: readActors,
  errors: readErrors,
});

export const appCreated = defineEvent("AppCreated", {
  subject: appIdSchema,
  payload: z.object({
    slug: slugSchema,
    name: appNameSchema,
    description: appDescriptionSchema,
    planning_version: versionIdSchema.optional(),
  }),
});
export const appSourceConnected = defineEvent("AppSourceConnected", {
  subject: appIdSchema,
  payload: z.object({ source_path: absolutePathSchema }),
});
// archive는 run_enabled=false를 함께 저장한다. unarchive도 false를 유지한다.
export const appArchived = defineEvent("AppArchived", {
  subject: appIdSchema,
  payload: z.object({ run_enabled: z.literal(false) }),
});
export const appUnarchived = defineEvent("AppUnarchived", {
  subject: appIdSchema,
  payload: z.object({ run_enabled: z.literal(false) }),
});
export const appRenamed = defineEvent("AppRenamed", {
  subject: appIdSchema,
  payload: z.object({ name: appNameSchema }),
});
export const appFoldersEdited = defineEvent("AppFoldersEdited", {
  subject: appIdSchema,
  payload: z.object({ folders: projectFoldersSchema }),
});

// 앱의 기록은 지워도 이 event는 남는다(event는 지우지 않는다).
export const appDeleted = defineEvent("AppDeleted", {
  subject: appIdSchema,
  payload: z.object({ slug: slugSchema }),
});
