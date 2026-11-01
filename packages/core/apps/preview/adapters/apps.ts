// 다른 앱 호출 대역. preview 자식은 다른 앱의 command를 부르지 못한다. 대상 앱이 있든 없든 같은
// 거절이라 존재를 새지 않는다. 시도한 대상과 command 이름은 메모리에 남겨 preview 확인에서 볼 수 있다.
import { brokerAppCallInputSchema } from "../../../../protocol/apps/mod.ts";
import type { AppsCallService } from "../../permissions/mod.ts";
import { invalid, refuse } from "./refusal.ts";

type PreviewAppCallAttempt = { app: string; command: string };

export type PreviewAppsCallService = AppsCallService & {
  readonly attempts: readonly PreviewAppCallAttempt[];
};

export function createPreviewAppsCallService(): PreviewAppsCallService {
  const attempts: PreviewAppCallAttempt[] = [];
  return {
    attempts,
    call(_child, body) {
      const parsed = brokerAppCallInputSchema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(invalid("apps call input is invalid"));
      }
      const { target_app: app, command } = parsed.data;
      attempts.push({ app, command });
      return Promise.resolve(refuse("app.call", { app, command }));
    },
  };
}
