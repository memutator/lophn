// broker `/_lophn/broker/notify/send`. 앱이 사람에게 알린다. 선언∩grant의 `notify.send`를 요청마다 검사한 뒤
// core의 app_notices.post를 그 자식의 app credential로 부른다. 앱은 notice 내용만 정하고 어느 앱인지는 자식
// 연결이 정한다. 받는 쪽은 사람뿐이다: agent나 core 로직에 사실을 보내는 길이 아니다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  type AppNoticePostInput,
  brokerNotifyInputSchema,
} from "../../../../protocol/apps/mod.ts";
import {
  type BrokerAccess,
  currentAccess,
  invalid,
  liveOnly,
  notifyGranted,
  refuse,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `app_notices.post`를 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface NoticePostPort {
  post(child: BrokerChild, input: AppNoticePostInput): Promise<Result<unknown>>;
}

export type NotifyService = {
  send(child: BrokerChild, body: unknown): Promise<Result<{ notified: true }>>;
};

export function createNotifyService(deps: {
  access: BrokerAccess;
  core: NoticePostPort;
}): NotifyService {
  return {
    async send(child, body) {
      const parsed = brokerNotifyInputSchema.safeParse(body);
      if (!parsed.success) return invalid("notify input is invalid");
      const refused = liveOnly(child, "notify.send", {});
      if (refused) return refused;
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      if (access.value === null || !notifyGranted(access.value)) {
        return refuse("notify.send", {});
      }
      const { title, body: text, key } = parsed.data;
      const posted = await deps.core.post(child, {
        title,
        ...(text === undefined ? {} : { body: text }),
        ...(key === undefined ? {} : { key }),
      });
      return posted.ok ? ok({ notified: true }) : posted;
    },
  };
}
