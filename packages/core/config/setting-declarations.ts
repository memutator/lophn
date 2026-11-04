import { declareSetting } from "../../protocol/config/mod.ts";
import {
  CALL_POLICY_SETTING_KEY,
  type CallPolicy,
  callPolicySchema,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import { createFileSettingsReader } from "./reader.ts";

// agent가 보내는 call의 place 쌍·agent 쌍 정책. 판정은 protocol의 mayCall이 한다.
export const callPolicySetting = declareSetting({
  key: CALL_POLICY_SETTING_KEY,
  type: callPolicySchema,
  default: DEFAULT_CALL_POLICY,
});

// writer·reader Worker처럼 store가 없는 곳이 data root의 설정 파일에서 읽는다.
export function callPolicyAt(root: string): CallPolicy {
  return (
    createFileSettingsReader(root).get(callPolicySetting) ?? DEFAULT_CALL_POLICY
  );
}
