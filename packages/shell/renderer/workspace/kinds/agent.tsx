// agent 탭 kind. 한 탭은 agent 하나와 이 project place의 session 하나를 담고
// 탭 안에서 agent를 바꾸지 않는다. layout에는 agent·자리·session 참조만 저장하고 다시 열 때 그대로 복원한다.
// 여는 길(sidebar 줄·activity bar 아래쪽 바로 가기·새 탭 menu·Ask)은 모두 openAgent 하나를 부른다.

import { useEffect } from "react";

import type { LophnNoticeApi } from "../../../ipc/notice.ts";
import type { AgentViewHost } from "../../conversation/agent-view.tsx";
import type { Draft } from "../../conversation/drafts.ts";
import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import { conversationIcons } from "../../icons/mod.ts";
import { Avatar } from "../../parts/avatar/avatar.tsx";
import { AgentNotReady, AgentTab } from "../agent/agent-tab.tsx";
import {
  agentOf,
  placeOf,
  SESSION_ID,
  sessionOf,
  TAB_KEY,
} from "../agent/tab-fields.ts";
import { isDetached, type TabItem, type WorkspaceView } from "../model.ts";
import { openAgents } from "./agents.tsx";
import type { AgentViewSlice, TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

interface OpenAgentInput {
  /** sidebar의 agent 줄이 주는 agent id. */
  readonly agent: string;
  /** 탭 제목이 될 agent 이름. source가 읽으면 그 이름으로 바뀐다. */
  readonly name: string;
  /** 열어 볼 session. 없으면 첫 말을 보낼 때 만드는 새 session이다. */
  readonly session?: string | null;
}

function agentTabs(host: TabHost): readonly TabItem[] {
  return host.windowTabs().filter((tab) => tab.kind === "agent");
}

/** 같은 agent의 같은 session이거나, 같은 agent의 아직 말하지 않은 열린 탭. */
function reusable(host: TabHost, input: OpenAgentInput): TabItem | undefined {
  const session = input.session ?? null;
  return agentTabs(host).find((tab) => {
    if (agentOf(tab) !== input.agent) return false;
    return session === null
      ? sessionOf(tab) === null
      : sessionOf(tab) === session;
  });
}

/** 탭 key는 작업대 안에서 유일하다. 열린 key와 겹치지 않는 가장 작은 번호를 쓴다. */
function freshKey(tabs: readonly TabItem[], agent: string): string {
  const used = new Set(tabs.map((tab) => tab.key));
  for (let n = 1; ; n += 1) {
    const key = `agent:${agent}:${n}`;
    if (!used.has(key)) return key;
  }
}

/**
 * detached 창이 연 agent 새 탭을 project 창이 받을 때 쓴다. 그 창은 자기 탭만 봐서 고른 key가 이 창의 다른
 * session 탭과 겹칠 수 있고, 그대로 열면 새 탭 대신 그 탭이 선택된다. 같은 session이면 그 탭을 고르는 것이 맞아 그대로 둔다.
 * `tabs`는 이 창 전체(모든 자리)의 탭이다.
 */
export function distinctAgentTab(
  view: WorkspaceView,
  tab: TabItem,
  tabs: readonly TabItem[],
): TabItem {
  const existing = tabs.find((item) => item.key === tab.key);
  const agent = agentOf(tab);
  if (existing === undefined || tab.kind !== "agent" || agent === null) {
    return tab;
  }
  // 보낸 창 자신의 탭이다.
  if (isDetached(view, tab.key)) return tab;
  const session = sessionOf(tab);
  if (
    existing.kind === "agent" &&
    agentOf(existing) === agent &&
    session !== null &&
    sessionOf(existing) === session
  )
    return tab;
  return { ...tab, key: freshKey(tabs, agent) };
}

/**
 * Agent 탭을 연다. 같은 agent의 같은 session이 열려 있거나 아직 말하지 않은 탭이 있으면 새로
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
    key: freshKey(host.windowTabs(), input.agent),
    kind: "agent",
    title: input.name,
    fields: {
      agent: input.agent,
      place: host.projectId,
      ...(session === null ? {} : { session }),
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
    // 편집 카드의 [Open]. 그 파일을 파일 탭으로 연다. 자리는 이 탭을 source로 `showAfter`가 정한다.
    openFile: (path) => slice.openFile(path, tab.key),
    runCommand: slice.runCommand,
    artifacts: slice.artifacts,
    // 권한 요약과 `/permissions`는 Agents 화면의 Permissions로 간다.
    openPermissions: () => openAgents(host),
    openAgentSettings: (target) => slice.openSettings(target),
    // Fork가 만든 session은 같은 agent의 새 탭이다. 이 탭은 자기 session에 남는다.
    openForked: (session) =>
      openAgent(host, { agent, name: tab.title, session }),
    // 이 project의 session이면 그 탭, 아니면 그 session의 창으로 간다(toast의 [Open]과 같은 길).
    openSession: (session) => runToastAction({ kind: "session", session }),
    // 사용량 화면은 이 화면의 몫이 아니라 아직 길이 없다.
    showUsage: () => {},
    // 탭만 닫는다. session은 그대로 남는다.
    closeTab: () => host.removeTab(tab.key),
    openConnections: slice.openConnections,
  };
}

/**
 * 이 session의 탭이 보이는 동안 main에 알린다. 알림과 finished 점이 "사람이 보고 있다"를 이것으로 판단한다.
 * 그려지는 탭은 각 칸에서 고른 탭뿐이라 마운트가 곧 보임이다.
 */
function ReportVisible({ session }: { session: string | null }) {
  useEffect(() => {
    const notice = (globalThis as { lophnNotice?: LophnNoticeApi }).lophnNotice;
    if (notice === undefined || session === null) return;
    void notice.visible({ session, visible: true });
    return () => void notice.visible({ session, visible: false });
  }, [session]);
  return null;
}

export const agentKind: TabKindDef = {
  kind: "agent",
  labelKey: "project-workspace.label.kind-agent",
  icon: conversationIcons.dock,
  // 그 agent의 profile 아이콘. 목록에서 찾지 못하면 종류 아이콘이다.
  iconOf(tab, host) {
    const agent = agentOf(tab);
    const profile =
      agent === null ? undefined : host.agentView?.profileOf(agent);
    return profile === undefined ? null : (
      <Avatar profile={profile} size="sm" />
    );
  },
  dotOf: (tab, host) => host.agentView?.dotOf(sessionOf(tab)) ?? null,
  // 탭 이름은 lophn session 제목이다. session 제목은 비울 수 없어 빈 이름은 무시한다.
  rename(tab, name, host) {
    const trimmed = name?.trim();
    const session = sessionOf(tab);
    const agent = agentOf(tab);
    const place = placeOf(tab);
    if (!trimmed || session === null || agent === null || place === null) {
      return;
    }
    const source = host.agentView?.factory({
      assignment: agent,
      place: { kind: "project", id: place },
    });
    if (source === undefined) return;
    void source.renameSession(session, trimmed).then((result) => {
      if (result.ok) host.patchTab(tab.key, () => ({ title: trimmed }));
    });
  },
  fromStored(stored, { key }) {
    const { agent, work_place: place, session } = stored;
    if (typeof agent !== "string" || agent.length === 0 || agent.length > 128) {
      return null;
    }
    const where = place as { kind?: unknown; id?: unknown } | null;
    if (
      typeof where !== "object" ||
      where === null ||
      where.kind !== "project" ||
      typeof where.id !== "string" ||
      where.id.length === 0 ||
      where.id.length > 128
    )
      return null;
    if (
      session !== undefined &&
      session !== null &&
      (typeof session !== "string" || !SESSION_ID.test(session))
    )
      return null;
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
  // 작성 중 말을 넘긴다. session 탭은 그 session의 draft 하나, 새 session 탭은 key를 탭이 모르므로
  // `new:` draft 전부다. store가 창마다 하나라 받는 창의 같은 key에 이미 글이 있으면 덮지 않는다.
  transfer(tab, host) {
    const drafts = host.agentView?.drafts;
    if (!drafts) return Promise.resolve({ value: null, views: [] });
    const session = sessionOf(tab);
    // 이미지는 이 창 메모리의 Blob이라 넘기지 못한다. 파일 경로만 따라간다.
    const found = drafts
      .entries((key) =>
        session === null ? key.startsWith("new:") : key === session,
      )
      .map(([key, draft]): [string, Draft] => [
        key,
        {
          ...draft,
          attachments: draft.attachments.filter((item) => item.kind === "file"),
        },
      ]);
    return Promise.resolve({ value: { drafts: found }, views: [] });
  },
  receive(_tab, { value }, host) {
    const drafts = host.agentView?.drafts;
    const moved = (value as { drafts?: unknown } | null)?.drafts;
    if (!drafts || !Array.isArray(moved)) return;
    for (const [key, draft] of moved as [string, Draft][]) {
      if (drafts.draft(key).text !== "") continue;
      drafts.save(key, draft);
    }
  },
  // agent·session은 현재 보기에 싣지 않는다. 대화 내용은 agent가 알 일이 아니다.
  render(tab, _active, host) {
    const agent = agentOf(tab);
    const place = placeOf(tab);
    if (agent === null || place === null) return null;
    const slice = host.agentView;
    if (slice === null) return <AgentNotReady />;
    // 다른 project의 자리로 저장된 탭은 이 project의 agent로 바꾸어 읽지 않는다.
    if (place !== host.projectId) return null;
    return (
      <>
        <ReportVisible session={sessionOf(tab)} />
        <AgentTab
          key={tab.key}
          agent={agent}
          place={place}
          slice={slice}
          session={sessionOf(tab)}
          onSession={(session) =>
            host.patchTab(tab.key, (current) => {
              const { session: _session, ...rest } = current.fields ?? {};
              return {
                fields: session === null ? rest : { ...rest, session },
              };
            })
          }
          host={viewHost(tab, host, slice)}
          title={tab.title}
          onTitle={(name) => host.patchTab(tab.key, () => ({ title: name }))}
        />
      </>
    );
  },
};
