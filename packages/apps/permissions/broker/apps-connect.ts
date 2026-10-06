// broker `/_lophn/broker/apps/connect`의 apps 쪽 구현(apps/connections#R1, R4, R5, apps/runtime#R30).
// source 앱 자식 연결의 신원(app·release·mode·process nonce)으로 제한된 다른 앱 connection 준비만
// 한다. 업무 payload를 중계하지 않고, 허락 범위·path·서명은 준비 서비스(apps/connections)가 정한다.
// 신원은 본문이 정하지 않는다. 본문이 다른 앱·nonce·mode를 말해도 자식 연결의 값만 쓴다.
import { err, type Result } from "../../../base/mod.ts";
import {
  type AppConnectOutput,
  brokerAppsConnectInputSchema,
  brokerAppsConnectOutputSchema,
} from "../../../contracts/apps/mod.ts";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

export type AppsConnectRequest = {
  source: BrokerChild;
  app: string;
  commands: readonly string[];
  parent_invocation: string | null;
};

// 연결 준비 서비스(core 쪽 apps/connections)의 포트다.
export interface AppPairPreparer {
  prepare(request: AppsConnectRequest): Promise<Result<AppConnectOutput>>;
}

export type AppsConnectService = {
  connect(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<AppConnectOutput>>;
};

export function createAppsConnectService(deps: {
  preparer: AppPairPreparer;
}): AppsConnectService {
  return {
    async connect(child, body) {
      const parsed = brokerAppsConnectInputSchema.safeParse(body);
      if (!parsed.success) return invalid("apps connect input is invalid");
      const input = parsed.data;
      if (
        input.process_nonce !== child.processNonce || input.mode !== child.mode
      ) {
        return err({
          code: "unauthorized",
          message: "connect does not match the child connection",
        });
      }
      const prepared = await deps.preparer.prepare({
        source: child,
        app: input.app,
        commands: input.commands,
        parent_invocation: input.parent_invocation,
      });
      if (!prepared.ok) return prepared;
      const output = brokerAppsConnectOutputSchema.safeParse(prepared.value);
      if (!output.success) {
        return err({
          code: "internal",
          message: "prepared connection does not match its contract",
        });
      }
      return { ok: true, value: output.data };
    },
  };
}
