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
import {
  fakeAgentSource,
  finishedReport,
  SESSION_EARLIER,
  SESSION_WEEK,
} from "../../conversation/testdata/fake-agent-source.ts";
import type { AgentViewSourceFactory } from "../../conversation/agent-source.ts";

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

// 옛 Agent 화면(agent-view.tsx)이 아직 쓰는 통로. 화면이 새 통로로 갈아타면 지운다.
export function mockAgentViewSource(): AgentViewSourceFactory {
  const fakes = new Map<string, ReturnType<typeof fakeAgentSource>>();
  return (agent) => {
    const key = `${agent.assignment}:${agent.place.kind}:${agent.place.id}`;
    let fake = fakes.get(key);
    if (fake === undefined) {
      fake = fakeAgentSource();
      fake.state.sessions = [SESSION_WEEK, SESSION_EARLIER];
      fake.state.threads[SESSION_WEEK.id] = finishedReport(fake);
      fakes.set(key, fake);
    }
    return fake.source;
  };
}
