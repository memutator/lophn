// mock 모드의 Agent 탭 통로. agent(담당과 자리)마다 메모리 source 하나를 만들어 두고, 같은 agent를 다시 얻으면
// 같은 기록을 본다. 끝난 일이 있는 대화와 이른 대화 하나씩을 채운다.
import {
  type AgentTabScene,
  createFakeAgentTabSource,
} from "../../conversation/agent-tab-fake-source.ts";
import type {
  AgentTabSource,
  AgentTabSourceFactory,
} from "../../conversation/agent-tab-source.ts";

export function mockAgentTabSource(
  scene: AgentTabScene = "report",
): AgentTabSourceFactory {
  const fakes = new Map<string, AgentTabSource>();
  return (agent) => {
    const key = `${agent.assignment}:${agent.place.kind}:${agent.place.id}`;
    let fake = fakes.get(key);
    if (fake === undefined) {
      fake = createFakeAgentTabSource({ scene });
      fakes.set(key, fake);
    }
    return fake;
  };
}

// `mod.ts`가 옛 이름으로 부른다. 호스트가 `mockAgentTabSource`로 갈아탄 뒤 cleanup이 지운다.
export const mockAgentViewSource = mockAgentTabSource;
