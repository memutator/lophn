import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { shellRulesSetting } from "../../../approvals/shell-rules/mod.ts";
import { sharedAppsSetting } from "../../../approvals/share-requests/mod.ts";
import { lophnAgentSettings } from "../../../lophn-agent/register.ts";
import { callPolicyPrivateStep } from "./call-policy-private.ts";
import type { WiringFactory } from "./context.ts";
import { placesDefaultOnStep } from "./places-default-on.ts";

// 각 module이 선언한 설정을 `settingDeclarations` 칸에 모으고 call 정책과 shell 설정의 data step을 낸다. config wiring이 build에서 읽으므로 그보다 앞에 둔다.
export const settingDeclarationsWiring: WiringFactory = () => ({
  name: "setting-declarations",
  dataSteps: [callPolicyPrivateStep, placesDefaultOnStep],
  prepare(ctx) {
    ctx.provide("settingDeclarations", [
      ...lophnAgentSettings,
      shellRulesSetting,
      sharedAppsSetting,
      callPolicySetting,
    ]);
  },
});
