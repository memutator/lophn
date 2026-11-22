// mock 모드의 Agent 탭 통로. agent(담당과 자리)마다 메모리 source 하나를 만들어 두고, 같은 agent를 다시 얻으면
// 같은 기록을 본다. 이름·avatar는 편집 화면과 같은 AgentsSource에서 읽어 탭과 대화 머리가 어긋나지 않게 한다.

import { t } from "@lophn/i18n";
import {
  type AgentTabScene,
  createFakeAgentTabSource,
} from "../../conversation/agent-tab-fake-source.ts";
import type {
  AgentTabSource,
  AgentTabSourceFactory,
} from "../../conversation/agent-tab-source.ts";
import type { FakeAgentsSource } from "../../workspace/agents/fake-source.ts";

export function mockAgentTabSource(
  agents: Pick<
    FakeAgentsSource,
    "readAgent" | "imageSrc" | "grants" | "changed"
  >,
  scene: AgentTabScene = "report",
): AgentTabSourceFactory {
  const fakes = new Map<string, AgentTabSource>();
  return (agent) => {
    const key = `${agent.assignment}:${agent.workspace.kind}:${agent.workspace.id}`;
    let fake = fakes.get(key);
    if (fake === undefined) {
      const source = createFakeAgentTabSource({ scene, now: Date.now });
      const project =
        agent.workspace.kind === "global" ? null : agent.workspace.id;
      fake = {
        ...source,
        async agent() {
          const read = await agents.readAgent(project, agent.assignment);
          if (!read.ok) return { ok: false, code: read.message };
          const grants = await agents.grants(project, agent.assignment);
          if (!grants.ok) return { ok: false, code: grants.message };
          const { workspace, effective } = read.value;
          const avatar = effective.avatar.value;
          return {
            ok: true,
            value: {
              agent: agent.assignment,
              name: effective.name.value,
              avatar:
                avatar.kind === "character"
                  ? avatar
                  : {
                      kind: "image",
                      src: agents.imageSrc(
                        project,
                        agent.assignment,
                        avatar.image,
                      ),
                    },
              // home(global)은 자리 칸이 없다.
              workspace:
                agent.workspace.kind === "global"
                  ? null
                  : {
                      kind: workspace.kind === "app" ? "app" : "project",
                      name: workspace.name,
                    },
              permissionSummary: t("conversation.label.permission-summary", {
                count: grants.value.entries.length,
              }),
            },
          };
        },
        changed(listener) {
          const unlistenSource = source.changed?.(listener);
          const unlistenAgents = agents.changed(listener);
          return () => {
            unlistenSource?.();
            unlistenAgents();
          };
        },
      };
      fakes.set(key, fake);
    }
    return fake;
  };
}
