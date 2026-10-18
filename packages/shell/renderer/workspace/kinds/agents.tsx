// agents 탭 kind. 이 project의 agent 카드와 설정 구역을 보이고, [Open]이나 [+ New Operator]로 같은 탭 안에서
// editor를 연다. 탭은 project에 하나이고 열어 둔 agent만 필드로 남긴다.
import { commonIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { AgentsPage } from "../agents/agents-page.tsx";
import { OPERATOR_ID } from "../agents/agent-key.ts";
import { TAB_KEY } from "../contexts/tab-fields.ts";
import type { TabItem } from "../model.ts";
import { PaddedTab } from "../panes/padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const AGENTS_TAB_KEY = "agents";

const BUILT_IN_KEYS = ["lophn", "project_manager", "app_engineer"];

// agent key는 내장 role 이름이거나 Operator의 `agt_…` ID다.
const isAgentKey = (value: unknown): value is string =>
  typeof value === "string" &&
  (OPERATOR_ID.test(value) || BUILT_IN_KEYS.includes(value));

/** 탭이 editor로 열어 둔 agent. 없거나 맞지 않으면 목록이다. */
function agentOf(tab: TabItem): string | null {
  const agent = tab.fields?.agent;
  return isAgentKey(agent) ? agent : null;
}

/** Agents 탭을 연다. 이미 열려 있으면 고르기만 한다(Manage와 `+`가 같은 길이다). */
export function openAgents(host: TabHost): void {
  host.openTab({
    key: AGENTS_TAB_KEY,
    kind: "agents",
    title: t("project-workspace.label.kind-agents"),
  });
}

export const agentsKind: TabKindDef = {
  kind: "agents",
  labelKey: "project-workspace.label.kind-agents",
  icon: commonIcons.roles,
  fromStored(stored, { key }) {
    const { agent } = stored;
    return {
      key,
      kind: "agents",
      title: t("project-workspace.label.kind-agents"),
      ...(isAgentKey(agent) ? { fields: { agent } } : {}),
    };
  },
  toStored(tab) {
    if (!TAB_KEY.test(tab.key)) return null;
    const agent = agentOf(tab);
    return {
      kind: "agents",
      key: tab.key,
      ...(agent === null ? {} : { agent }),
    };
  },
  // 열어 둔 agent는 현재 보기에 싣지 않는다. 어느 카드를 보는지는 agent가 알 일이 아니다.
  render(tab, _active, host) {
    const agents = host.agents;
    if (agents === null) return null;
    return (
      <PaddedTab bare>
        <AgentsPage
          key={tab.key}
          project={host.projectId}
          projectName={host.projectTitle ?? ""}
          source={agents.source}
          agent={agentOf(tab)}
          onAgent={(assignment) =>
            host.patchTab(tab.key, () => ({
              fields: assignment === null ? undefined : { agent: assignment },
            }))}
          contexts={(host.contexts?.list ?? []).map((item) => ({
            id: item.id,
            name: item.title,
          }))}
          onEditInstructions={agents.editInstructions}
          onAddExtension={agents.openExtensions}
          onChanged={agents.changed}
        />
      </PaddedTab>
    );
  },
};
