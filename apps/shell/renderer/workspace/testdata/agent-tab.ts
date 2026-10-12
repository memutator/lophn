// Agent 탭 test의 고정 값. agent마다 conversation의 fake source 하나를 두는 AgentViewSourceFactory를 만들고,
// 어떤 agent와 자리로 물었는지 남긴다. agent 정체는 Agents 통로 fake(workspace/agents/fake-source.ts)의 것과 같다.
import type { AgentViewSourceFactory } from "../../conversation/agent-source.ts";
import {
  CONTEXT_ENGINEER,
  type FakeAgent,
  fakeAgentSource,
  LOPHN,
} from "../../conversation/testdata/fake-agent-source.ts";
import { ENGINEER_ID, LOPHN_ID, RELEASE_ID } from "../agents/fake-source.ts";

export { ENGINEER_ID, LOPHN_ID, RELEASE_ID };

export const PROJECT = "prj_1";

const FACES = {
  [LOPHN_ID]: { ...LOPHN, assignment: LOPHN_ID },
  [ENGINEER_ID]: { ...CONTEXT_ENGINEER, assignment: ENGINEER_ID },
  [RELEASE_ID]: {
    ...LOPHN,
    assignment: RELEASE_ID,
    name: "Release notes",
    role: "operator" as const,
  },
};

export interface AgentTabFixture {
  readonly factory: AgentViewSourceFactory;
  /** factory를 부른 agent와 자리. 같은 탭이 다시 그려져도 새로 묻지 않는다. */
  readonly asked: {
    readonly assignment: string;
    readonly place: { readonly kind: string; readonly id: string };
  }[];
  /** agent 하나의 fake. 없으면 만든다. mount 전에 session과 thread를 채울 수 있다. */
  fake(assignment: string): FakeAgent;
}

export function agentTabFixture(): AgentTabFixture {
  const fakes = new Map<string, FakeAgent>();
  const asked: AgentTabFixture["asked"][number][] = [];
  const fake = (assignment: string): FakeAgent => {
    const found = fakes.get(assignment);
    if (found !== undefined) return found;
    const face = FACES[assignment as keyof typeof FACES];
    if (face === undefined) throw new Error(`unknown agent ${assignment}`);
    const created = fakeAgentSource({ agent: face });
    fakes.set(assignment, created);
    return created;
  };
  return {
    asked,
    fake,
    factory: (agent) => {
      asked.push({ assignment: agent.assignment, place: agent.place });
      return fake(agent.assignment).source;
    },
  };
}
