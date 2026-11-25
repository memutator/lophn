import {
  DEFAULT_LOCAL_TOOL_TRUST_SETTING,
  DEFAULT_MODE_SETTING_KEY,
  DEFAULT_PERMISSION_RULES_SETTING,
  DEFAULT_WORKFLOW_MODES_SETTING,
  LOCAL_TOOL_TRUST_SETTING_KEY,
  localToolTrustSettingSchema,
  PERMISSION_RULES_SETTING_KEY,
  permissionRulesSettingSchema,
  WORKFLOW_MODES_SETTING_KEY,
  workflowModesSettingSchema,
} from "../../../protocol/approvals/mod.ts";
import { declareSetting } from "../../../protocol/config/mod.ts";
import {
  DEFAULT_PERMISSION_MODE,
  permissionModeSchema,
} from "../../../protocol/lophn-agent/turn-values.ts";

// 전역과 project 통합 권한 규칙. 사람만 바꾼다(Settings > Permissions 또는 승인 카드의 항상 허락).
export const permissionRulesSetting = declareSetting({
  key: PERMISSION_RULES_SETTING_KEY,
  type: permissionRulesSettingSchema,
  default: DEFAULT_PERMISSION_RULES_SETTING,
  description:
    "Unified permission rules (shell, file, app_tool, mcp_tool, local_tool), global and per project. Only the person changes it.",
  locked: true,
});

// 전역 기본 권한 단계. agent 정의의 permission_mode가 비면 새 session이 이 값을 따른다.
export const defaultModeSetting = declareSetting({
  key: DEFAULT_MODE_SETTING_KEY,
  type: permissionModeSchema,
  default: DEFAULT_PERMISSION_MODE,
  description:
    "Default permission mode for new sessions when an agent definition does not set permission_mode. Only the person changes it.",
  locked: true,
});

// workflow별 participant 기억 권한 단계. workflow 파일이 아니라 data root 설정에만 둔다.
export const workflowModesSetting = declareSetting({
  key: WORKFLOW_MODES_SETTING_KEY,
  type: workflowModesSettingSchema,
  default: DEFAULT_WORKFLOW_MODES_SETTING,
  description:
    "Remembered permission modes per project workflow and participant. Only the person changes it.",
  locked: true,
});

// 로컬 tool 스크립트 신뢰 목록 `(실제 경로, sha256)`. 사람만 바꾼다.
export const localToolTrustSetting = declareSetting({
  key: LOCAL_TOOL_TRUST_SETTING_KEY,
  type: localToolTrustSettingSchema,
  default: DEFAULT_LOCAL_TOOL_TRUST_SETTING,
  description:
    "Trusted local tool scripts keyed by canonical path and sha256 hash. Only the person changes it.",
  locked: true,
});

export const approvalSettings = [
  permissionRulesSetting,
  defaultModeSetting,
  workflowModesSetting,
  localToolTrustSetting,
] as const;
