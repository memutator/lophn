import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { atSchema, readCursorSchema } from "../base/values.ts";
import { projectIdSchema } from "../projects/values.ts";
import { appIdSchema } from "./channel-values.ts";

// notice는 사람에게 "답할 것"(승인·질문)이 아닌 것을 알리는 ledger 표 하나다(`architecture/app-notice.md`).
// 출처는 둘이다. app: 앱 process가 사람에게 하는 알림(cap-notify). program: core가 남기는 기록(release 결과 등).
// 받는 쪽은 사람뿐이다. core나 agent에 사실을 밀어 넣는 길이 아니다.
// - 휘발(persistent=false): 사람이 지우면 행이 사라진다. 앱마다 NOTICE_EPHEMERAL_PER_APP_MAX개, 넘으면 오래된 것부터 지운다.
// - 영구(persistent=true): 지우면 read_at만 채우고 행은 남는다. 앱마다 최근 NOTICE_PERSISTENT_PER_APP_MAX개. program 행은
//   늘 영구이고 지우지 않는다.
// 앱은 `app_notices.post`로 자기 행만 쓴다(앱은 입력에 없다. 자식 credential이 고정한다). program 행은 core 안 machine만 쓰고
// 글은 고정 template + 매개변수로 core가 만든다(앱이 쓴 글이 program 행에 들어가지 않는다).
// 같은 (source, app, key)의 행이 있으면 새 행이 그것을 대신한다(id 그대로, 내용·시각 갱신, 안 읽음으로 되돌린다).
// 남지 않는 event(`packages/protocol/events/transient.ts`): NoticePosted(행 한 건), NoticeClosed { id }, NoticeRead { id, read_at }.

export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 500;
export const NOTICE_KEY_MAX = 64;
export const NOTICE_EPHEMERAL_PER_APP_MAX = 50;
export const NOTICE_PERSISTENT_PER_APP_MAX = 200;
export const NOTICE_LIST_LIMIT_MAX = 200;

const noticeIdSchema = idSchema("ntc");
export const noticeTitleSchema = z.string().trim().min(1).max(NOTICE_TITLE_MAX);
export const noticeBodySchema = z.string().trim().max(NOTICE_BODY_MAX);
export const noticeKeySchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_.:-]{1,${NOTICE_KEY_MAX}}$`));

export const NOTICE_SOURCES = ["app", "program"] as const;
export const noticeSourceSchema = z.enum(NOTICE_SOURCES);

// program이 남기는 종류. 앱이 쓴 행의 종류는 `app` 하나다.
export const PROGRAM_NOTICE_KINDS = [
  "release_activated",
  "release_failed",
  "release_rolled_back",
  "app_unavailable",
  "app_data_migrated",
  "app_data_restored",
  "lophn_updated",
  "sdk_update_needed",
  "session_stopped_by_app",
  "phone_changed",
] as const;
export const programNoticeKindSchema = z.enum(PROGRAM_NOTICE_KINDS);
export type ProgramNoticeKind = z.infer<typeof programNoticeKindSchema>;
export const noticeKindSchema = z.enum(["app", ...PROGRAM_NOTICE_KINDS]);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

// 행을 누르면 할 일. 화면은 종류로만 그리고 실행한다. 종류를 더하면 이 union에 더하고 화면이 그 종류를 그린다.
export const noticeActionSchema = z.discriminatedUnion("kind", [
  // home lophn 대화를 그 skill로 연다. 사람이 단추를 눌러 시작한다.
  z.strictObject({
    kind: z.literal("open_home_skill"),
    skill: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(64),
    args: z.string().max(500),
  }),
]);
export type NoticeAction = z.infer<typeof noticeActionSchema>;

export const noticeSchema = z.strictObject({
  id: noticeIdSchema,
  source: noticeSourceSchema,
  // 앱의 행이거나 앱에 관한 기록이면 그 앱. lophn 전체에 관한 기록은 null이다.
  app: appIdSchema.nullable(),
  // 사람에게 보일 이름. 읽을 때 푼 것이다.
  app_name: z.string().min(1).nullable(),
  project: projectIdSchema.nullable(),
  kind: noticeKindSchema,
  key: noticeKeySchema.nullable(),
  title: noticeTitleSchema,
  body: noticeBodySchema,
  persistent: z.boolean(),
  action: noticeActionSchema.nullable(),
  created_at: atSchema,
  read_at: atSchema.nullable(),
});
export type Notice = z.infer<typeof noticeSchema>;

export const noticePost = defineCommand({
  resource: "notices",
  method: "post",
  name: "notices.post",
  changes: ["notices"],
  input: z.strictObject({
    title: noticeTitleSchema,
    body: noticeBodySchema.optional(),
    key: noticeKeySchema.optional(),
    // 기본은 휘발이다.
    persistent: z.boolean().optional(),
  }),
  output: z.object({ id: noticeIdSchema }),
  actors: ["app"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export type NoticePostInput = z.infer<typeof noticePost.input>;

// program 행의 매개변수다. 글은 core의 template(`packages/core/apps/notices/program-text.ts`)이 만든다.
// 값은 짧은 식별자·판·이유 코드다. 앱이 쓴 글을 싣지 않는다.
const short = z.string().trim().min(1).max(40);
const reason = z.string().trim().min(1).max(200);

function variant<K extends ProgramNoticeKind, P extends z.ZodRawShape>(
  kind: K,
  params: P,
) {
  return z.strictObject({
    kind: z.literal(kind),
    params: z.strictObject(params),
    // 앱 없는 kind(lophn_updated·sdk_update_needed·phone_changed) 말고는 앱이 있어야 한다(command가 본다).
    app: appIdSchema.optional(),
    project: projectIdSchema.optional(),
    key: noticeKeySchema.optional(),
    action: noticeActionSchema.optional(),
  });
}

export const noticeRecordInputSchema = z.discriminatedUnion("kind", [
  variant("release_activated", { release: short }),
  variant("release_failed", { release: short, reason }),
  variant("release_rolled_back", { release: short, to: short }),
  variant("app_unavailable", { reason }),
  variant("app_data_migrated", { release: short }),
  variant("app_data_restored", { release: short }),
  variant("lophn_updated", { from: short, to: short }),
  // 앱 없이 한 줄이다(숲을 보는 일은 home lophn의 몫이라 앱마다 줄을 만들지 않는다).
  // required: 옮겨야 하는 앱 수, available: 필수는 아니지만 새 SDK 판이 있는 앱 수.
  // 앱이 session의 도는 turn을 멈췄다(`app_sessions.stop`). 어느 앱인지는 행의 app이다. title은 session 제목이다(앱이 쓴 글이 아니다).
  variant("session_stopped_by_app", {
    session: short,
    title: short.optional(),
  }),
  variant("sdk_update_needed", {
    required: z.number().int().min(0).max(9999),
    available: z.number().int().min(0).max(9999),
  }),
  // 기준 폰이 바뀌었다. apps: 폰 화면이 있는 활성 앱 수(옛 폰 크기로 그린 화면이라 다시 그려야 한다).
  variant("phone_changed", { apps: z.number().int().min(1).max(9999) }),
]);
export type NoticeRecordInput = z.infer<typeof noticeRecordInputSchema>;

// core 안 machine만 쓴다. 사람·agent·앱·renderer는 program 행을 쓰지 못한다.
export const noticeRecord = defineCommand({
  resource: "notices",
  method: "record",
  name: "notices.record",
  changes: ["notices"],
  input: noticeRecordInputSchema,
  output: z.object({ id: noticeIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// core가 켜질 때 지금 제품 판을 알리고 data root에 적힌 마지막 판과 견준다. 다르면 lophn_updated 행을 남기고 판을 새로 적는다.
// 설치된 SDK 판(sdks: 이름 → 판)도 같은 자리에 적고 견준다(sdks_changed). 행은 남기지 않고 SDK 감지를 돌릴지 알리는 신호다.
// fresh(새 data root)는 판만 적고 행을 남기지 않는다. 적힌 판이 없는 옛 data root는 from을 모르는 채로 행을 남긴다(from null).
export const noticesObserveVersion = defineCommand({
  resource: "notices",
  method: "observe_version",
  name: "notices.observe_version",
  changes: ["notices"],
  input: z.strictObject({
    version: short,
    fresh: z.boolean(),
    // 설치 사본을 못 읽었으면 빼고, 그 기동은 SDK 판을 견주지 않는다.
    sdks: z.record(short, short).optional(),
  }),
  output: z.object({
    // 판이 바뀐 기동이면 true. fresh이거나 같은 판이면 false다.
    changed: z.boolean(),
    // 바뀌기 전에 적힌 판. 모르면(fresh, 옛 data root) null이다.
    from: z.string().nullable(),
    // 설치된 SDK 판이 적힌 것과 달랐으면 true. fresh이거나 같으면 false다. 적힌 것이 없던 옛 data root는 true다.
    sdks_changed: z.boolean(),
  }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const noticeDismiss = defineCommand({
  resource: "notices",
  method: "dismiss",
  name: "notices.dismiss",
  changes: ["notices"],
  input: z.strictObject({ id: noticeIdSchema }),
  output: z.object({ id: noticeIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 영구 행을 읽음으로 바꾼다(한 번에 여럿). 휘발 행과 이미 읽은 행, 없는 id는 건너뛰고 오류가 아니다.
export const noticeMarkRead = defineCommand({
  resource: "notices",
  method: "mark_read",
  name: "notices.mark_read",
  changes: ["notices"],
  input: z.strictObject({ ids: z.array(noticeIdSchema).min(1).max(200) }),
  output: z.object({ marked: z.number().int().nonnegative() }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 기록 화면용. 최근 것이 먼저다. 보관한 앱의 행도 읽는다(예전 release를 찾을 수 있어야 한다).
export const noticesList = defineRead({
  resource: "notices",
  method: "list",
  name: "notices.list",
  input: z.strictObject({
    source: noticeSourceSchema.optional(),
    app: appIdSchema.optional(),
    project: projectIdSchema.optional(),
    kind: noticeKindSchema.optional(),
    persistent: z.boolean().optional(),
    // true면 안 읽은 것만(휘발 행은 모두 안 읽은 것이다), false면 읽은 것만.
    unread: z.boolean().optional(),
    // title이나 body에 들어 있는 글(대소문자 무시).
    query: z.string().trim().min(1).max(100).optional(),
    // created_at 기간. since는 포함, until은 미포함이다.
    since: atSchema.optional(),
    until: atSchema.optional(),
    cursor: readCursorSchema.optional(),
    limit: z.number().int().min(1).max(NOTICE_LIST_LIMIT_MAX).optional(),
  }),
  output: withReadCommon(z.object({ notices: z.array(noticeSchema) })),
  reads: ["notices"],
  actors: ["user", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// Inbox가 지금 보이는 줄: 안 읽은 행 전부(휘발 + 안 읽은 영구). 보관한 앱의 행은 뺀다. 오래된 것이 먼저다.
export const noticesOpen = defineRead({
  resource: "notices",
  method: "open",
  name: "notices.open",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ notices: z.array(noticeSchema) })),
  reads: ["notices"],
  actors: ["user", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const NOTICE_ROUTES = [
  noticePost,
  noticeRecord,
  noticesObserveVersion,
  noticeDismiss,
  noticeMarkRead,
  noticesList,
  noticesOpen,
] as const;
