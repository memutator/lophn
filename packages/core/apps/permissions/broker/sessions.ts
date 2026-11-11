// broker `/_lophn/broker/sessions/{list,status,stop}`. 앱 process가 session 목록·상태를 읽고 멈춘다. 어느 앱인지는 자식 연결이 정하고, 어느
// session이 보이는지(앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace)는 core가 판정한다. 사람 허락(grant)은 없다: 읽기와
// 멈추기는 사람이 정한 call 정책 안이고, 멈춘 일은 사람이 볼 수 있게 기록된다. 부모 invocation이 돌고 있지 않아도 된다.
import { err, type Result } from "../../../../base/mod.ts";
import { z } from "zod";
import {
  appSessionsList,
  appSessionsStatus,
  appSessionsStop,
} from "../../../../protocol/lophn-agent/session-lifecycle.ts";
import { processNonceSchema } from "../../../../protocol/apps/channel-values.ts";
import { type BrokerAccess, currentAccess, invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

export type SessionsOperation = "list" | "status" | "stop";

// core의 `app_sessions.*`를 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface SessionsPort {
  call(
    child: BrokerChild,
    operation: SessionsOperation,
    input: unknown,
  ): Promise<Result<unknown>>;
}

export type SessionsService = {
  call(
    child: BrokerChild,
    operation: SessionsOperation,
    body: unknown,
  ): Promise<Result<unknown>>;
};

const ROUTE = {
  list: appSessionsList,
  status: appSessionsStatus,
  stop: appSessionsStop,
} as const;

const childFields = z.object({
  process_nonce: processNonceSchema,
  mode: z.enum(["live", "preview"]),
});

export function createSessionsService(deps: {
  access: BrokerAccess;
  core: SessionsPort;
}): SessionsService {
  return {
    async call(child, operation, body) {
      // 자식이 정하는 칸(process_nonce, mode)은 떼고 route 입력만 검사한다. 앱은 입력에 없다.
      const stripped = childFields.safeParse(body);
      if (!stripped.success) return invalid("sessions input is invalid");
      const {
        process_nonce: _nonce,
        mode: _mode,
        ...rest
      } = body as Record<string, unknown>;
      const parsed = ROUTE[operation].input.safeParse(rest);
      if (!parsed.success) return invalid("sessions input is invalid");
      if (child.mode !== "live" || child.release === null) {
        return err({
          code: "forbidden",
          message: "only a live app process reads sessions",
        });
      }
      // 시작 코드가 session 목록을 읽는다(읽기뿐이라 채택 중인 후보도 받는다).
      const access = await currentAccess(deps.access, child, {
        servesCandidate: true,
      });
      if (!access.ok) return access;
      if (access.value === null) {
        return err({
          code: "forbidden",
          message: "the process is not the active release",
        });
      }
      return deps.core.call(child, operation, parsed.data);
    },
  };
}
