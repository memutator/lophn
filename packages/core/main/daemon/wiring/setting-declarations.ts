import {
  approvalSettings,
  migrateShellRulesDataStep,
} from "../../../approvals/mod.ts";
import { declareSetting } from "../../../../protocol/config/mod.ts";
import {
  CODING_DEPLOYED_SKILLS_SETTING_KEY,
  deployedSkillsSchema,
} from "../../../../protocol/lophn-agent/skill-settings.ts";
import {
  callPolicySetting,
  diagnosticsTraceSetting,
  teamSetting,
} from "../../../config/setting-declarations.ts";
import {
  destinationsSetting,
  sharedFolderSetting,
} from "../../../folder/destinations.ts";
import { lophnAgentSettings } from "../../../lophn-agent/register.ts";
import { projectsFolderSetting } from "../../../projects/clone/mod.ts";
import { projectsWorktreesFolderSetting } from "../../../projects/worktrees/mod.ts";
import { appearanceThemesStep } from "./appearance-themes.ts";
import { callPolicyPrivateStep } from "./call-policy-private.ts";
import { codingGuiFlagStep } from "./coding-gui-flag.ts";
import { sharedAppsSettingDropStep } from "./share-requests-retired.ts";
import type { WiringFactory } from "./context.ts";
import { placesDefaultOnStep } from "./places-default-on.ts";

// coding agent에게 배포한 앱 skill(harness가 넷째 배포 자리). 바꾸는 길은 `lophn skill deploy --to harness`와 Settings다.
export const codingDeployedSkillsSetting = declareSetting({
  key: CODING_DEPLOYED_SKILLS_SETTING_KEY,
  type: deployedSkillsSchema,
  default: [],
  description:
    "App skills deployed to coding agents in the terminal (app slug and skill name). lophn copies each into the skill folder of every harness whose lophn hook is installed.",
  locked: true,
});

// 각 module이 선언한 설정을 `settingDeclarations` 칸에 모으고 call 정책과 권한 설정의 data step을 낸다. config wiring이 build에서 읽으므로 그보다 앞에 둔다.
export const settingDeclarationsWiring: WiringFactory = () => ({
  name: "setting-declarations",
  dataSteps: [
    callPolicyPrivateStep,
    placesDefaultOnStep,
    appearanceThemesStep,
    codingGuiFlagStep,
    sharedAppsSettingDropStep,
    migrateShellRulesDataStep,
  ],
  prepare(ctx) {
    ctx.provide("settingDeclarations", [
      ...lophnAgentSettings,
      ...approvalSettings,
      codingDeployedSkillsSetting,
      callPolicySetting,
      teamSetting,
      diagnosticsTraceSetting,
      projectsFolderSetting,
      projectsWorktreesFolderSetting,
      destinationsSetting(ctx.root.path),
      sharedFolderSetting(ctx.root.path),
    ]);
  },
});
