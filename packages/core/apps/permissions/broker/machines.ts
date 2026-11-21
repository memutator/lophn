// broker `/_lophn/broker/machines/list`. 앱 process가 사람의 컴퓨터 명단과 자기가 도는 컴퓨터를 읽는다. 어느 앱인지는 자식 연결이
// 정한다. 사람 허락(grant)은 없다: 컴퓨터 이름과 켜짐 상태뿐이고 사람이 연 앱이 자기 컴퓨터를 아는 것은 앱의 기본 사실이다.

import { z } from "zod";
import type { Result } from "../../../../base/mod.ts";
import { processNonceSchema } from "../../../../protocol/apps/channel-values.ts";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `machine.computers`를 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface MachinesPort {
  list(child: BrokerChild): Promise<Result<unknown>>;
}

export type MachinesService = {
  list(child: BrokerChild, body: unknown): Promise<Result<unknown>>;
};

const input = z.strictObject({
  process_nonce: processNonceSchema,
  mode: z.enum(["live", "preview"]),
});

export function createMachinesService(deps: {
  core: MachinesPort;
}): MachinesService {
  return {
    list(child, body) {
      if (!input.safeParse(body).success) {
        return Promise.resolve(invalid("machines input is invalid"));
      }
      return deps.core.list(child);
    },
  };
}
