// CLI가 core에 내밀 token을 고른다. harness가 띄운 shell에는 host가 turn 자격(agent credential)을 env로 넣어 두므로
// 그것이 있으면 사람의 user token file보다 앞선다: harness는 사람이 아니라 그 session의 agent로 부른다.
import { AGENT_CREDENTIAL_ENV } from "../../../protocol/coding-agent/headless/env.ts";

export function connectionToken(
  env: { get(name: string): string | undefined },
  userTokenFile: () => string | undefined,
): string | undefined {
  const agent = env.get(AGENT_CREDENTIAL_ENV);
  if (agent !== undefined && agent !== "") return agent;
  return userTokenFile() || undefined;
}
