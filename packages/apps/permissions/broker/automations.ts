// broker `/_lophn/broker/automations/{try_acquire,release}`. 앱 안 clock이 회차를 시작하기 직전에
// permit을 요청한다(apps/automations#R5, R6, R13). 신원은 자식 연결이 정하고 본문의 release는 연결의
// release와 같아야 한다.
//
// external command는 사람이 그 automation을 켠 승인(Grant kind `automation.run`)이 현재 선언과 같은
// 범위로 active일 때만 permit을 낸다. 요청마다 현재 grant를 다시 읽으므로 끄면(grant.revoke) 다음
// 회차부터 permit이 나가지 않고 프로세스를 다시 띄우지 않는다. external이 아닌 automation은 앱 실행
// 허용을 따른다(clock이 열려 있을 때만 요청한다). secret 사용은 여기서 보지 않는다. grant가 정한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  AUTOMATION_CONCURRENCY_LIMIT,
  AUTOMATION_TIMEOUT_MS,
  brokerAutomationReleaseInputSchema,
  brokerAutomationTryAcquireInputSchema,
} from "../../../protocol/apps/mod.ts";
import {
  type BrokerAccess,
  currentAccess,
  invalid,
  unavailable,
} from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// automations/permits.ts가 이 모양을 만족한다. permissions는 automations를 import하지 않는다.
export interface AutomationPermitPort {
  tryAcquire(
    holder: { nonce: string; release: string; key: string },
  ): "granted" | "busy" | "limit";
  release(holder: { nonce: string; release: string; key: string }): boolean;
}

export type AutomationTryAcquireOutput = {
  permit: boolean;
  limit: typeof AUTOMATION_CONCURRENCY_LIMIT;
  timeout_ms: typeof AUTOMATION_TIMEOUT_MS;
};

export type AutomationBroker = {
  tryAcquire(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<AutomationTryAcquireOutput>>;
  release(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<{ released: true }>>;
};

function mismatch(): Result<never> {
  return err({
    code: "unauthorized",
    message: "request does not match the child connection",
  });
}

export function createAutomationBroker(deps: {
  access: BrokerAccess;
  permits: AutomationPermitPort;
}): AutomationBroker {
  return {
    async tryAcquire(child, body) {
      const parsed = brokerAutomationTryAcquireInputSchema.safeParse(body);
      if (!parsed.success) return invalid("automation request is invalid");
      const input = parsed.data;
      if (
        input.process_nonce !== child.processNonce || input.mode !== child.mode
      ) return mismatch();
      // preview·test 자식과 release 없는 자식은 clock을 열지 않는다(R4).
      if (child.mode !== "live" || child.release === null) {
        return unavailable("automation clock is closed for this process");
      }
      if (input.release !== child.release) {
        return err({
          code: "conflict",
          message: "automation release is not the child's release",
        });
      }
      const found = await currentAccess(deps.access, child);
      if (!found.ok) return found;
      // 교체됐거나 앱·release를 더 모르면 옛 자식은 새 회차를 시작하지 못한다.
      if (found.value === null) {
        return err({
          code: "conflict",
          message: "release is not current",
        });
      }
      const declared = found.value.automations.find((entry) =>
        entry.key === input.key
      );
      if (!declared) return invalid("automation is not declared");
      if (declared.external) {
        const approved = found.value.scope.automations.some((entry) =>
          entry.automation === declared.key
        );
        if (!approved) {
          // 필요한 승인 범위를 알린다. 선언 밖이든 승인 밖이든 앱 코드에는 같은 모양이다.
          return err({
            code: "forbidden",
            message: "automation.run is not approved for this automation",
            details: {
              permission: "automation.run",
              scope: {
                automation: declared.key,
                command: declared.command,
                input_hash: declared.input_hash,
                when: declared.when,
              },
            },
          });
        }
      }
      const outcome = deps.permits.tryAcquire({
        nonce: child.processNonce,
        release: child.release,
        key: input.key,
      });
      return ok({
        permit: outcome === "granted",
        limit: AUTOMATION_CONCURRENCY_LIMIT,
        timeout_ms: AUTOMATION_TIMEOUT_MS,
      });
    },
    release(child, body) {
      const parsed = brokerAutomationReleaseInputSchema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(invalid("automation release is invalid"));
      }
      const input = parsed.data;
      if (
        input.process_nonce !== child.processNonce || input.mode !== child.mode
      ) return Promise.resolve(mismatch());
      // 이미 푼 점유의 반납은 같은 결과다. 다른 자식의 점유는 풀지 못한다.
      deps.permits.release({
        nonce: child.processNonce,
        release: input.release,
        key: input.key,
      });
      return Promise.resolve(ok({ released: true as const }));
    },
  };
}
