import { shellRulesSetting } from "../../../approvals/shell-rules/mod.ts";
import { sharedAppsSetting } from "../../../approvals/share-requests/mod.ts";
import { lophnAgentSettings } from "../../../lophn-agent/register.ts";
import { harnessEnabledSetting } from "../../../lophn-agent/session/mod.ts";
import type { WiringFactory } from "./context.ts";

// 각 module이 선언한 설정을 `settingDeclarations` 칸에 모은다. config wiring이 build에서 읽으므로 그보다 앞에 둔다.
export const settingDeclarationsWiring: WiringFactory = () => ({
  name: "setting-declarations",
  prepare(ctx) {
    ctx.provide("settingDeclarations", [
      ...lophnAgentSettings,
      harnessEnabledSetting,
      shellRulesSetting,
      sharedAppsSetting,
    ]);
  },
});
