// broker `/_lophn/broker/ready`. 앱 시작이 DB를 바꿨을 때 앱 process가 그 changeset을 알린다.
// supervisor는 이 값을 시작 사실(record_started)에 실어 core에 넘긴다. 신원은 자식 연결이 정한다.
import { ok, type Result } from "../../../../base/mod.ts";
import { brokerReadyInputSchema } from "../../../../protocol/apps/mod.ts";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

export interface ReadyReceiver {
  ready(child: BrokerChild, notice: { startChangeset: string | null }): void;
}

export type ReadyService = {
  ready(child: BrokerChild, body: unknown): Result<{ accepted: true }>;
};

export function createReadyService(deps: {
  receiver: ReadyReceiver;
}): ReadyService {
  return {
    ready(child, body) {
      const parsed = brokerReadyInputSchema.safeParse(body);
      if (!parsed.success) return invalid("ready input is invalid");
      deps.receiver.ready(child, {
        startChangeset: parsed.data.start_changeset ?? null,
      });
      return ok({ accepted: true });
    },
  };
}
