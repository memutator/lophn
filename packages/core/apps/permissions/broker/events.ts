// broker `/_lophn/broker/events/publish`. 앱이 일이 일어난 뒤의 알림(event)을 낸다. 어느 앱인지는 자식 연결이 정하고, 선언한
// event인지와 payload가 schema에 맞는지는 core가 본다. 사람 허락(grant)은 없다: event는 발행 앱이 선언해 내놓는 것이다.
// 앱 호출과 달리 부모 invocation이 돌고 있어야 하지 않는다(시작 코드와 timer에서도 낸다).
import { err, type Result } from "../../../../base/mod.ts";
import {
  type AppEventPublishInput,
  brokerEventPublishInputSchema,
} from "../../../../protocol/apps/events.ts";
import { type BrokerAccess, currentAccess, invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `app_events.publish`를 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface EventPublishPort {
  publish(
    child: BrokerChild,
    input: AppEventPublishInput,
  ): Promise<Result<unknown>>;
}

export type EventsService = {
  publish(child: BrokerChild, body: unknown): Promise<Result<unknown>>;
};

export function createEventsService(deps: {
  access: BrokerAccess;
  core: EventPublishPort;
}): EventsService {
  return {
    async publish(child, body) {
      const parsed = brokerEventPublishInputSchema.safeParse(body);
      if (!parsed.success) return invalid("event publish input is invalid");
      if (child.mode !== "live" || child.release === null) {
        return err({
          code: "forbidden",
          message: "only a live app process publishes events",
        });
      }
      // 교체된 옛 release의 자식은 새 선언의 event를 내지 못한다.
      const access = await currentAccess(deps.access, child);
      if (!access.ok) return access;
      if (access.value === null) {
        return err({
          code: "forbidden",
          message: "the process is not the active release",
        });
      }
      const { event, payload, parent_invocation } = parsed.data;
      return deps.core.publish(child, { event, payload, parent_invocation });
    },
  };
}
