// 다른 앱 호출 대역. preview 자식은 다른 앱의 app-api를 부르지 못한다. 대상 앱이 있든 없든 같은
// 거절이라 존재를 새지 않는다. 시도한 대상과 app-api 이름은 메모리에 남겨 preview 확인에서 볼 수 있다.
import { brokerAppCallInputSchema } from "../../../../protocol/apps/mod.ts";
import type { AppsCallService } from "../../permissions/mod.ts";
import { invalid, refuse } from "./refusal.ts";

export type PreviewAppCallAttempt = { app: string; api: string };

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
      const { target_app: app, api } = parsed.data;
      attempts.push({ app, api });
      return Promise.resolve(refuse("app.call", { app, api }));
    },
  };
}
