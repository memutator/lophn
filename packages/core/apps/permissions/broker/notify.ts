// broker `/_lophn/broker/notify/send`. 앱이 사람에게 알린다. 선언∩grant의 `notify.send`를 요청마다 검사한 뒤
// core의 notices.post를 그 자식의 app credential로 부른다. 앱은 notice 내용만 정하고 어느 앱인지는 자식
// 연결이 정한다. 받는 쪽은 사람뿐이다: agent나 core 로직에 사실을 보내는 길이 아니다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  type NoticePostInput,
  brokerNotifyInputSchema,
} from "../../../../protocol/apps/mod.ts";
import {
  type AppTraySetInput,
  brokerTrayInputSchema,
} from "../../../../protocol/apps/tray.ts";
import {
  type AppWidgetSetInput,
  brokerWidgetInputSchema,
} from "../../../../protocol/apps/widget.ts";
import {
  type BrokerAccess,
  currentAccess,
  invalid,
  liveOnly,
  notifyGranted,
  refuse,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `notices.post`, `app_tray.set`, `app_widget.set`을 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface NoticePostPort {
  post(child: BrokerChild, input: NoticePostInput): Promise<Result<unknown>>;
  setTray(child: BrokerChild, input: AppTraySetInput): Promise<Result<unknown>>;
  setWidget(
    child: BrokerChild,
    input: AppWidgetSetInput,
  ): Promise<Result<unknown>>;
}

export type NotifyService = {
  send(child: BrokerChild, body: unknown): Promise<Result<{ notified: true }>>;
  // tray 값은 알림과 같은 권한(notify.send)이다. text가 null이면 지운다.
  tray(child: BrokerChild, body: unknown): Promise<Result<{ set: true }>>;
  // 위젯 값도 같은 권한이다. value가 null이면 지운다.
  widget(child: BrokerChild, body: unknown): Promise<Result<{ set: true }>>;
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
      const { title, body: text, key, persistent } = parsed.data;
      const posted = await deps.core.post(child, {
        title,
        ...(text === undefined ? {} : { body: text }),
        ...(key === undefined ? {} : { key }),
        ...(persistent === undefined ? {} : { persistent }),
      });
      return posted.ok ? ok({ notified: true }) : posted;
    },
    async tray(child, body) {
      const parsed = brokerTrayInputSchema.safeParse(body);
      if (!parsed.success) return invalid("tray input is invalid");
      const refused = liveOnly(child, "notify.send", {});
      if (refused) return refused;
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      if (access.value === null || !notifyGranted(access.value)) {
        return refuse("notify.send", {});
      }
      const { text, tone } = parsed.data;
      const set = await deps.core.setTray(child, {
        text,
        ...(tone === undefined ? {} : { tone }),
      });
      return set.ok ? ok({ set: true }) : set;
    },
    async widget(child, body) {
      const parsed = brokerWidgetInputSchema.safeParse(body);
      if (!parsed.success) return invalid("widget input is invalid");
      const refused = liveOnly(child, "notify.send", {});
      if (refused) return refused;
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      if (access.value === null || !notifyGranted(access.value)) {
        return refuse("notify.send", {});
      }
      const { key, value } = parsed.data;
      const set = await deps.core.setWidget(child, { key, value });
      return set.ok ? ok({ set: true }) : set;
    },
  };
}
