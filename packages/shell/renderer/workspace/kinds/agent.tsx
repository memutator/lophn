// agent 탭 kind. 한 탭은 place에 놓인 agent 하나(built-in 또는 Operator)와 그 agent의 session 하나를 담고
// 탭 안에서 agent를 바꾸지 않는다. layout에는 agent·자리·session 참조만 저장하고 다시 열 때 그대로 복원한다.
// 여는 길(sidebar 줄·rail·새 탭 menu·Ask)은 모두 openAgent 하나를 부른다.
import { Avatar } from "@lophn/design/components";

import { conversationIcons } from "../../icons/mod.ts";

import type { AgentViewHost } from "../../conversation/agent-view.tsx";
import type { ContextChipView } from "../../conversation/composer/agent-composer.tsx";
import { AgentNotReady, AgentTab } from "../agent/agent-tab.tsx";
import {
  agentOf,
  chipsOf,
  placeOf,
  SESSION_ID,
  sessionOf,
  TAB_KEY,
} from "../agent/tab-fields.ts";
import type { TabItem } from "../model.ts";
import { openAgents } from "./agents.tsx";
import type { AgentViewSlice, TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

export interface OpenAgentInput {
  /** sidebar의 agent 줄이 주는 agent id. */
  readonly agent: string;
  /** 탭 제목이 될 agent 이름. source가 읽으면 그 이름으로 바뀐다. */
  readonly name: string;
  /** 열어 볼 session. 없으면 첫 말을 보낼 때 만드는 새 session이다. */
  readonly session?: string | null;
  /** 새 session의 첫 context(notification의 [Ask], 계약 위반 toast가 여는 Project Manager의 위반 근거). 보낼 때까지 아무것도 보내지 않는다. */
  readonly chips?: readonly ContextChipView[];
}

function agentTabs(host: TabHost): TabItem[] {
  return host.view.panes.flatMap((pane) =>
    pane.tabs.filter((tab) => tab.kind === "agent")
  );
}

/** 같은 agent의 같은 session이거나, 같은 agent의 아직 말하지 않은 같은 시작(첫 context)인 열린 탭. */
function reusable(host: TabHost, input: OpenAgentInput): TabItem | undefined {
  const session = input.session ?? null;
  const ids = (input.chips ?? []).map((chip) => chip.id).join();
  return agentTabs(host).find((tab) => {
    if (agentOf(tab) !== input.agent) return false;
    if (session !== null) return sessionOf(tab) === session;
    return sessionOf(tab) === null &&
      chipsOf(tab).map((chip) => chip.id).join() === ids;
  });
}

/** 탭 key는 작업대 안에서 유일하다. 열린 key와 겹치지 않는 가장 작은 번호를 쓴다. */
function freshKey(host: TabHost, agent: string): string {
  const used = new Set(
    host.view.panes.flatMap((pane) => pane.tabs.map((tab) => tab.key)),
  );
  for (let n = 1;; n += 1) {
    const key = `agent:${agent}:${n}`;
    if (!used.has(key)) return key;
  }
}

/**
 * Agent 탭을 연다. 같은 agent의 같은 session이 열려 있거나 아직 말하지 않은 같은 시작의 탭이 있으면 새로
 * 만들지 않고 그 탭을 고른다. 그 밖에는 그 agent의 새 탭이다. 통로가 없으면 열지 않는다.
 */
export function openAgent(host: TabHost, input: OpenAgentInput): void {
  if (host.agentView === null) return;
  const found = reusable(host, input);
  if (found !== undefined) {
    host.openTab(found);
    return;
  }
  const session = input.session ?? null;
  host.openTab({
    key: freshKey(host, input.agent),
    kind: "agent",
    title: input.name,
    fields: {
      agent: input.agent,
      place: host.projectId,
      ...(session === null ? {} : { session }),
      ...(input.chips === undefined || input.chips.length === 0
        ? {}
        : { chips: input.chips }),
    },
  });
}

/** 탭 하나의 Agent 화면이 작업대에 닿는 길. */
function viewHost(
  tab: TabItem,
  host: TabHost,
  slice: AgentViewSlice,
): AgentViewHost {
  const agent = agentOf(tab)!;
  return {
    openResult: slice.openResult,
    ...(slice.contexts === undefined ? {} : { contexts: slice.contexts }),
    // 권한 요약과 `/permissions`는 Agents 화면의 Permissions로 간다.
    openPermissions: () => openAgents(host),
    openAgentSettings: () => slice.openSettings(),
    // Fork가 만든 session은 같은 agent의 새 탭이다. 이 탭은 자기 session에 남는다.
    openForked: (session) =>
      openAgent(host, { agent, name: tab.title, session }),
    // 사용량 화면과 첨부는 이 화면의 몫이 아니라 아직 길이 없다.
    showUsage: () => {},
    // 탭만 닫는다. session은 그대로 남는다.
    closeTab: () => host.removeTab(tab.key),
    attach: () => {},
    ...(slice.openConnections === undefined
      ? {}
      : { openConnections: slice.openConnections }),
  };
}

export const agentKind: TabKindDef = {
  kind: "agent",
  labelKey: "project-workspace.label.kind-agent",
  icon: conversationIcons.dock,
  // 그 agent의 profile 아이콘. 목록에서 찾지 못하면 종류 아이콘이다.
  iconOf(tab, host) {
    const agent = agentOf(tab);
    const profile = agent === null
      ? undefined
      : host.agentView?.profileOf(agent);
    return profile === undefined
      ? null
      : <Avatar profile={profile} size="sm" />;
  },
  dotOf: (tab, host) => host.agentView?.dotOf(sessionOf(tab)) ?? null,
  fromStored(stored, { key }) {
    const { agent, work_place: place, session } = stored;
    if (typeof agent !== "string" || agent.length === 0 || agent.length > 128) {
      return null;
    }
    const where = place as { kind?: unknown; id?: unknown } | null;
    if (
      typeof where !== "object" || where === null || where.kind !== "project" ||
      typeof where.id !== "string" || where.id.length === 0 ||
      where.id.length > 128
    ) return null;
    if (
      session !== undefined && session !== null &&
      (typeof session !== "string" || !SESSION_ID.test(session))
    ) return null;
    return {
      key,
      kind: "agent",
      // agent 이름은 source가 읽은 뒤 채운다. 파일에는 제목을 남기지 않는다.
      title: "",
      fields: {
        agent,
        place: where.id,
        ...(typeof session === "string" ? { session } : {}),
      },
    };
  },
  toStored(tab) {
    const agent = agentOf(tab);
    const place = placeOf(tab);
    if (agent === null || place === null || !TAB_KEY.test(tab.key)) {
      return null;
    }
    const session = sessionOf(tab);
    return {
      kind: "agent",
      key: tab.key,
      agent,
      work_place: { kind: "project", id: place },
      ...(session === null ? {} : { session }),
    };
  },
  // agent·session은 현재 보기에 싣지 않는다. 대화 내용은 agent가 알 일이 아니다.
  hint: (tab) => ({ kind: "agent", key: tab.key }),
  render(tab, _active, host) {
    const agent = agentOf(tab);
    const place = placeOf(tab);
    if (agent === null || place === null) return null;
    const slice = host.agentView;
    if (slice === null) return <AgentNotReady />;
    // 다른 project의 자리로 저장된 탭은 이 project의 agent로 바꾸어 읽지 않는다.
    if (place !== host.projectId) return null;
    const chips = chipsOf(tab);
    return (
      <AgentTab
        key={tab.key}
        agent={agent}
        place={place}
        slice={slice}
        session={sessionOf(tab)}
        // 말을 시작하면 첫 context는 쓸모를 다한다. 새 탭 상태로 되돌아오지 않게 비운다.
        onSession={(session) =>
          host.patchTab(tab.key, (current) => {
            const { chips: _chips, session: _session, ...rest } =
              current.fields ?? {};
            return {
              fields: session === null ? rest : { ...rest, session },
            };
          })}
        host={viewHost(tab, host, slice)}
        title={tab.title}
        onTitle={(name) => host.patchTab(tab.key, () => ({ title: name }))}
        {...(chips.length === 0 ? {} : { chips })}
      />
    );
  },
};
