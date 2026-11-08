// harness가 띄운 shell에는 host가 turn 자격(agent credential)을 env로 넣어 둔다. 그것이 있으면
// 사람의 user 자격으로 바꾸지 않는다: harness는 사람이 아니라 그 session의 agent로 부른다.
import { AGENT_CREDENTIAL_ENV } from "../../../protocol/coding-agent/headless/env.ts";

export function agentCredential(env: {
  get(name: string): string | undefined;
}): string | undefined {
  const agent = env.get(AGENT_CREDENTIAL_ENV);
  return agent === undefined || agent === "" ? undefined : agent;
}
