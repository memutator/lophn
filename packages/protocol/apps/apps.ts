import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import {
  archiveStateSchema,
  defineCommand,
  defineEvent,
  definePort,
  defineRead,
  idSchema,
  withReadCommon,
} from "../server/mod.ts";
import {
  absolutePathSchema,
  appIdSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
} from "../projects/values.ts";

export const releaseIdSchema = idSchema("rel");

// 화면 이름. 입력한 이름을 보존하므로 slug 문법을 강제하지 않는다(apps/registration#R7).
export const appNameSchema = z.string().min(1);
// 한 줄 목적. 빈 문자열과 줄바꿈은 금지다(domain-model apps/registration).
export const appDescriptionSchema = z.string().min(1).refine(
  (value) => !/[\r\n]/.test(value),
  { message: "description must be a single line" },
);

// documents가 자리 해석에서 부르는 존재·status·slug. runtime 상태는 없다.
export const appRegistrationSchema = z.object({
  id: appIdSchema,
  slug: slugSchema,
  status: archiveStateSchema,
});
export type AppRegistration = z.infer<typeof appRegistrationSchema>;

// Tx.port 또는 ReadSnapshot.port가 같은 transaction·snapshot의 구현을 주입한다.
// archived도 돌려주므로 호출한 concern이 필요한 status를 검사한다.
export interface AppRegistrationLookup {
  get(app: z.infer<typeof appIdSchema>): Result<AppRegistration | null>;
}

export const appRegistrationLookup = definePort<AppRegistrationLookup>(
  "apps.AppRegistrationLookup",
);

const appFields = {
  id: appIdSchema,
  slug: slugSchema,
  name: appNameSchema,
  description: appDescriptionSchema,
  planning_version: versionIdSchema.nullable(),
  source_path: absolutePathSchema.nullable(),
  active_release: releaseIdSchema.nullable(),
  // App의 마지막 변경 seq이며 read snapshot 전체의 as_of_seq와 다르다.
  revision: revisionSchema,
  run_enabled: z.boolean(),
  status: archiveStateSchema,
};
export const appSchema = z.object(appFields).refine(
  (value) => value.status !== "archived" || !value.run_enabled,
  { message: "archived app cannot enable execution" },
);
export type App = z.infer<typeof appSchema>;

export const appCompareSchema = z.strictObject({
  base_revision: revisionSchema,
});

export const appCreateInputSchema = z.strictObject({
  // 미리 배정한 app ID. 사람이 고른 질문 선택지의 고정 action만 앱 ID를 먼저 정할 수 있다
  // (lophn-agent/questions#R13). 없으면 등록이 ID를 만든다. 사람 자격(user)만 쓴다.
  id: appIdSchema.optional(),
  slug: slugSchema,
  name: appNameSchema,
  description: appDescriptionSchema,
  planning_version: versionIdSchema.optional(),
});
export const appConnectSourceInputSchema = z.strictObject({
  app: appIdSchema,
  source_path: absolutePathSchema,
});
export const appInputSchema = z.strictObject({ app: appIdSchema });

// 등록은 user 또는 전체 scope coding connection만 받는다(architecture/apps 5.4).
export const appCreate = defineCommand({
  resource: "apps",
  method: "create",
  name: "app.create",
  input: appCreateInputSchema,
  output: appSchema,
  compare: z.strictObject({}),
  actors: ["user", "coding_agent"],
  errors: ["forbidden", "invalid_input", "conflict"],
});
// source 연결은 user 또는 그 앱 범위 connection만 받는다.
export const appConnectSource = defineCommand({
  resource: "apps",
  method: "connect_source",
  name: "app.connect_source",
  input: appConnectSourceInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user", "coding_agent"],
  errors: ["forbidden", "invalid_input", "conflict", "not_found"],
});
export const appArchive = defineCommand({
  resource: "apps",
  method: "archive",
  name: "app.archive",
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
  input: appInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "not_found"],
});
export const appRenameInputSchema = z.strictObject({
  app: appIdSchema,
  name: appNameSchema,
});
export const appRename = defineCommand({
  resource: "apps",
  method: "rename",
  name: "app.rename",
  input: appRenameInputSchema,
  output: appSchema,
  compare: appCompareSchema,
  actors: ["user"],
  errors: ["conflict", "invalid_input", "not_found"],
});

export const appListInputSchema = z.strictObject({
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
const readActors = ["user", "coding_agent", "agent", "app"] as const;
export const appList = defineRead({
  resource: "apps",
  method: "list",
  name: "app.list",
  input: appListInputSchema,
  output: withReadCommon(z.object({ apps: z.array(appSchema) })),
  actors: readActors,
  errors: readErrors,
});
export const appGet = defineRead({
  resource: "apps",
  method: "get",
  name: "app.get",
  input: appInputSchema,
  output: withReadCommon(z.object({ app: appSchema })),
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
