// agents 탭 kind. 전역 agent와 이 workspace(Home, project, 앱) 범위 agent의 카드, 설정 구역을 보이고, [Open]이나 [New agent]로
// 같은 탭 안에서 editor를 연다. 탭은 workspace에 하나이고 열어 둔 agent만 필드로 남긴다. agent를 열면 탭 이름과 아이콘이 그 agent가 되고,
// 저장하지 않은 편집이 있으면 문서 탭처럼 탭 줄에 표시가 뜨고 닫을 때 묻는다.
import { AgentFaceIcon } from "../../parts/agent-session/agent-session.tsx";
import { commonIcons } from "../../icons/mod.ts";
import { workspaceKey } from "../../shell/desk-model.ts";
import { t } from "@lophn/i18n";

import { AgentsPage } from "../agents/agents-page.tsx";
import { isAgentId } from "../agents/agent-key.ts";
import { TAB_KEY } from "../agent/tab-fields.ts";
import type { Face } from "../agents/tab-state.ts";
import type { TabItem } from "../model.ts";
import { PaddedTab } from "../padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const AGENTS_TAB_KEY = "agents";

/** 탭이 editor로 열어 둔 agent. 없거나 맞지 않으면 목록이다. */
function agentOf(tab: TabItem): string | null {
  const agent = tab.fields?.agent;
  return isAgentId(agent) ? agent : null;
}

/** Agents 탭을 연다. 이미 열려 있으면 고르기만 한다(sidebar의 Agents 줄, + 메뉴의 Agents, 권한 popover의 Edit in Agents가 부른다). */
export function openAgents(host: TabHost): void {
  host.openTab({
    key: AGENTS_TAB_KEY,
    kind: "agents",
    title: t("project-workspace.label.kind-agents"),
  });
}

/** 탭 줄에 보일 열린 agent의 얼굴. 본문이 보고한 것이 먼저이고(저장 전의 새 agent도 보고한다), 아직 그리지 않은 탭은 sidebar 목록에서 찾는다. */
function faceOf(tab: TabItem, host: TabHost): Face | undefined {
  const agents = host.agents;
  if (agents === null) return undefined;
  const reported = agents.tabs.faceOf(tab.key);
  if (reported !== null) return reported;
  const agent = agentOf(tab);
  return agent === null ? undefined : agents.faceOf(agent);
}

export const agentsKind: TabKindDef = {
  kind: "agents",
  labelKey: "project-workspace.label.kind-agents",
  icon: commonIcons.agents,
  titleOf: (tab, host) => faceOf(tab, host)?.name,
  iconOf(tab, host) {
    const face = faceOf(tab, host);
    return face === undefined ? null : (
      <AgentFaceIcon face={{ kind: "lophn", profile: face.profile }} />
    );
  },
  // 저장하지 않은 편집이 있으면 사람에게 묻는다. 사람이 이미 잃기를 확인한 길(`confirmed`)은 묻지 않는다.
  beforeClose(tab, host, options) {
    const agents = host.agents;
    if (agents === null) return null;
    const leave = () => agents.tabs.delete(tab.key);
    if (options?.confirmed === true || !agents.tabs.isDirty(tab.key)) {
      leave();
      return null;
    }
    const sessions = host.props.editor?.sessions;
    if (sessions === undefined) return Promise.resolve(false);
    return sessions
      .askDiscard(agents.tabs.faceOf(tab.key)?.name ?? tab.title)
      .then((discard) => {
        if (discard) leave();
        return discard;
      });
  },
  fromStored(stored, { key }) {
    const { agent } = stored;
    return {
      key,
      kind: "agents",
      title: t("project-workspace.label.kind-agents"),
      ...(isAgentId(agent) ? { fields: { agent } } : {}),
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
    const { workspace } = host;
    // Home은 이름이 없는 자리라 글을 따로 둔다.
    const name =
      workspace.kind === "home"
        ? t("agents.label.workspace-home")
        : ((workspace.kind === "project" ? host.projectTitle : host.appName) ??
          "");
    return (
      <PaddedTab bare>
        <AgentsPage
          key={tab.key}
          workspace={workspaceKey(workspace)}
          workspaceName={name}
          source={agents.source}
          tabKey={tab.key}
          tabs={agents.tabs}
          agent={agentOf(tab)}
          askLeave={(who) =>
            host.props.editor?.sessions.askDiscard(who) ??
            Promise.resolve(false)
          }
          onAgent={(assignment) =>
            host.patchTab(tab.key, () => ({
              fields: assignment === null ? undefined : { agent: assignment },
            }))
          }
          onAddExtension={agents.openExtensions}
          onChanged={agents.changed}
        />
      </PaddedTab>
    );
  },
};
