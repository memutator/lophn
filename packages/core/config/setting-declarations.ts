import { z } from "zod";
import { declareSetting } from "../../protocol/config/mod.ts";
import {
  CALL_POLICY_SETTING_KEY,
  type CallPolicy,
  callPolicySchema,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import {
  DEFAULT_TEAM_LIMITS,
  TEAM_SETTING_KEY,
  type TeamLimits,
  teamLimitsSchema,
} from "../../protocol/lophn-agent/team.ts";
import { DIAGNOSTICS_TRACE_SETTING_KEY } from "../../protocol/diagnostics/mod.ts";
import { createFileSettingsReader } from "./reader.ts";

// agent가 보내는 call의 workspace 쌍·agent 쌍 정책. 판정은 protocol의 mayCall이 한다.
export const callPolicySetting = declareSetting({
  key: CALL_POLICY_SETTING_KEY,
  type: callPolicySchema,
  default: DEFAULT_CALL_POLICY,
  description:
    "Which agents may call which: rules per workspace pair and per agent pair. It decides what agents can reach, so only the person changes it (Settings > Agents).",
  locked: true,
});

// writer·reader Worker처럼 store가 없는 곳이 data root의 설정 파일에서 읽는다.
export function callPolicyAt(root: string): CallPolicy {
  return (
    createFileSettingsReader(root).get(callPolicySetting) ?? DEFAULT_CALL_POLICY
  );
}

// 팀(`team spawn`)의 크기 상한. 키가 없으면 기본값이라 data step은 없다.
export const teamSetting = declareSetting({
  key: TEAM_SETTING_KEY,
  type: teamLimitsSchema,
  default: DEFAULT_TEAM_LIMITS,
  description:
    "Upper bounds on the teams an agent builds with `lophn team spawn`. Only the person changes it.",
  locked: true,
});

export function teamLimitsAt(root: string): TeamLimits {
  return createFileSettingsReader(root).get(teamSetting) ?? DEFAULT_TEAM_LIMITS;
}

// 켜면 core·agent runtime의 debug log와 span 줄, shell main의 터미널 trace를 data root의 logs에 남긴다. 값은 도는 중에도 바로 적용된다.
export const diagnosticsTraceSetting = declareSetting({
  key: DIAGNOSTICS_TRACE_SETTING_KEY,
  type: z.boolean(),
  default: false,
  description:
    "Write debug logs, span lines and terminal traces to the logs folder of the data root. Applies at once. Turn it on to investigate a problem and off afterwards.",
});
