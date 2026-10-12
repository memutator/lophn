// 다른 앱 조회 대역(apps/preview#R4). preview는 다른 앱의 실제 connection을 받지 못하고, 대역도
// 가짜 connection을 만들지 않는다. 대상 앱이 있든 없든 같은 거절이라 존재를 새지 않는다. 시도한
// 대상과 command는 메모리에 남겨 preview 확인에서 볼 수 있다.
import type { Result } from "../../../base/mod.ts";
import { brokerAppsConnectInputSchema } from "../../../protocol/apps/mod.ts";
import type { BrokerChild } from "../../permissions/mod.ts";
import { invalid, refuse } from "./refusal.ts";

export type PreviewAppAttempt = { app: string; commands: readonly string[] };

// broker의 `/apps/connect` 서비스와 같은 모양(child, body)이다. 서비스 자리는 앱 쌍 연결 작업이
// BrokerServices에 더한다.
export type PreviewAppsService = {
  connect(child: BrokerChild, body: unknown): Promise<Result<never>>;
  readonly attempts: readonly PreviewAppAttempt[];
};

export function createPreviewAppsService(): PreviewAppsService {
  const attempts: PreviewAppAttempt[] = [];
  return {
    attempts,
    connect(_child, body) {
      const parsed = brokerAppsConnectInputSchema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(invalid("apps connect input is invalid"));
      }
      const { app, commands } = parsed.data;
      attempts.push({ app, commands: [...commands] });
      return Promise.resolve(refuse("app.call", { app, commands }));
    },
  };
}
