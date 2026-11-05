import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { appIdSchema } from "./channel-values.ts";

// 앱 notice. 앱 process가 사람에게 하는 알림이다(cap-notify). 앱이 core나 agent에 사실을 밀어 넣는 길이 아니다:
// 받는 쪽은 사람의 Inbox와 toast·OS 알림뿐이다. 앱은 입력에 없다. 앱 자식 credential이 고정한 앱이다.
// 권한(`notify.send` grant)은 broker가 요청마다 판정하고, 이 command는 그 뒤에서 표에 쓴다.
// 같은 (app, key)의 열린 notice가 있으면 새 notice가 그것을 대신한다(id는 그대로, 내용·시각을 갱신). key가 없으면 매번 더한다.
// 앱마다 열린 notice는 NOTICE_PER_APP_MAX개이고 넘으면 오래된 것부터 지운다.
// 남지 않는 event(`packages/protocol/events/transient.ts`): AppNoticePosted(notice 한 건), AppNoticeClosed { id }.

export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 500;
export const NOTICE_KEY_MAX = 64;
export const NOTICE_PER_APP_MAX = 50;

const noticeIdSchema = idSchema("ntc");
export const noticeTitleSchema = z.string().trim().min(1).max(NOTICE_TITLE_MAX);
export const noticeBodySchema = z.string().trim().max(NOTICE_BODY_MAX);
export const noticeKeySchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_.:-]{1,${NOTICE_KEY_MAX}}$`));

export const appNoticeSchema = z.strictObject({
  id: noticeIdSchema,
  app: appIdSchema,
  // 사람에게 보일 이름. 읽을 때 푼 것이다.
  app_name: z.string().min(1),
  key: noticeKeySchema.nullable(),
  title: noticeTitleSchema,
  body: noticeBodySchema,
  created_at: atSchema,
});
export type AppNotice = z.infer<typeof appNoticeSchema>;

export const appNoticePost = defineCommand({
  resource: "app_notices",
  method: "post",
  name: "app_notices.post",
  input: z.strictObject({
    title: noticeTitleSchema,
    body: noticeBodySchema.optional(),
    key: noticeKeySchema.optional(),
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

export type AppNoticePostInput = z.infer<typeof appNoticePost.input>;

export const appNoticeDismiss = defineCommand({
  resource: "app_notices",
  method: "dismiss",
  name: "app_notices.dismiss",
  input: z.strictObject({ id: noticeIdSchema }),
  output: z.object({ id: noticeIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

export const appNoticesList = defineRead({
  resource: "app_notices",
  method: "list",
  name: "app_notices.list",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ notices: z.array(appNoticeSchema) })),
  actors: ["user", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const APP_NOTICE_ROUTES = [
  appNoticePost,
  appNoticeDismiss,
  appNoticesList,
] as const;
