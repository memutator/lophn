// agent 탭 kind. 한 탭은 agent 하나와 이 project workspace의 session 하나를 담고
// 탭 안에서 agent를 바꾸지 않는다. 저장하지 않는다(fromStored·toStored가 없다): 탭은 이 창 메모리(layout-source의 창 메모리)에만
// 살고 다시 켜면 sidebar의 Recent나 Main 묶음에서 사람이 연다. session은 core가 갖고 있어 대화는 그대로다.
// 여는 길(sidebar 줄·activity bar 아래쪽 바로 가기·새 탭 menu·Ask)은 모두 openAgent 하나를 부른다.
// 같은 project 줄 안의 다른 기계 session은 그 기계(`TabItem.machine`)를 단 탭이다: 그 기계의 agent 통로로 읽고, 탭의 workspace
// 칸은 그 기계 안의 workspace다.

import { useEffect, useRef } from "react";

import type { AgentViewHost } from "../../conversation/agent-view.tsx";
import { desktopParts } from "../../conversation/desktop-parts-impl.tsx";
import type { Draft } from "../../conversation/drafts.ts";
import { useReportVisible } from "../../conversation/report-visible.ts";
import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import { useEventClient } from "../../desktop/connection/events/hooks.tsx";
import { conversationIcons } from "../../icons/mod.ts";
import { newId } from "../../prefixed-id.ts";
import { AgentFaceIcon } from "../../parts/agent-session/agent-session.tsx";
import { AgentNotReady, AgentTab } from "../agent/agent-tab.tsx";
import {
  agentOf,
  workspaceOf,
  sessionOf,
  sourceWorkspaceOf,
} from "../agent/tab-fields.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import { newSessionKey } from "../../conversation/agent-view-model.ts";
import type { ProjectCopy } from "../agent/machine-copies.ts";
import type { Desk, WorkspaceRef } from "../../shell/desk-model.ts";
import { whereInDesk } from "../../shell/desk-model.ts";
import type { TabItem } from "../model.ts";
import { openAgents } from "./agents.tsx";
import { openPage } from "./page-view.tsx";
import type { AgentViewSlice, TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

// 탭 fields.workspace와 layout의 Home 표식. project id와 겹치지 않는다.
const HOME = "home";

// 탭 fields.workspace: 그 기계 안의 workspace(Home, project id, app id). 기계는 탭과 workspace의 `machine`이 든다.
const fieldOf = (ref: WorkspaceRef) => (ref.kind === "home" ? HOME : ref.id);

// 탭의 agent 통로. 기계를 단 탭은 그 기계의 것이다.
function factoryOf(
  tab: TabItem,
  host: TabHost,
): AgentTabSourceFactory | undefined {
  return tab.machine === undefined
    ? host.agentView?.factory
    : host.machineData(tab.machine).agentViewSource;
}

/** agent가 연 탭의 key·자리. 고르지 않고 열며 float이면 떠 있는 패널로 연다(options.minimized면 접어서). */
export interface SessionTabOpen {
  readonly key?: string;
  readonly options?: Parameters<TabHost["openTab"]>[1] & {
    readonly minimized?: boolean;
  };
  readonly float?: boolean;
}

interface OpenAgentInput extends SessionTabOpen {
  /** sidebar의 agent 줄이 주는 agent id. */
  readonly agent: string;
  /** 탭 제목이 될 agent 이름. source가 읽으면 그 이름으로 바뀐다. */
  readonly name: string;
  /** 열어 볼 session. 없으면 첫 말을 보낼 때 만드는 새 session이다. */
  readonly session?: string | null;
  /** 다른 기계의 session이면 그 기계와 그 기계 안의 workspace(`home`, project id, app id). */
  readonly machine?: string;
  readonly workspace?: string;
}

function agentTabs(host: TabHost): readonly TabItem[] {
  return host.windowTabs().filter((tab) => tab.kind === "agent");
}

/** 같은 agent의 같은 session이거나, 같은 agent의 아직 말하지 않은 열린 탭. */
function reusable(host: TabHost, input: OpenAgentInput): TabItem | undefined {
  const session = input.session ?? null;
  return agentTabs(host).find((tab) => {
    // agent id(`lophn_home`, `lophn_<app id>`)는 기계마다 같다.
    if (agentOf(tab) !== input.agent || tab.machine !== input.machine) {
      return false;
    }
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
  desk: Desk,
  tab: TabItem,
  tabs: readonly TabItem[],
): TabItem {
  const existing = tabs.find((item) => item.key === tab.key);
  const agent = agentOf(tab);
  if (existing === undefined || tab.kind !== "agent" || agent === null) {
    return tab;
  }
  // 보낸 창 자신의 탭이다.
  if (whereInDesk(desk, tab.key) === "detached") return tab;
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
 * 만들지 않고 그 탭을 고른다(`options.select`가 false면 고르지 않는다). 그 밖에는 그 agent의 새 탭이다.
 * 통로가 없으면 열지 않고 false다.
 */
export function openAgent(host: TabHost, input: OpenAgentInput): boolean {
  if (host.agentView === null) return false;
  const found = reusable(host, input);
  if (found !== undefined) {
    host.openTab(found, input.options);
    return true;
  }
  const session = input.session ?? null;
  const tab: TabItem = {
    key: input.key ?? freshKey(host.windowTabs(), input.agent),
    kind: "agent",
    title: input.name,
    ...(input.machine === undefined ? {} : { machine: input.machine }),
    fields: {
      agent: input.agent,
      workspace: input.workspace ?? fieldOf(host.workspace),
      ...(session === null ? {} : { session }),
    },
  };
  if (input.float === true) host.openFloat(tab, undefined, input.options);
  else host.openTab(tab, input.options);
  return true;
}

/**
 * 아직 session이 없는 탭을 같은 project의 다른 기계 사본으로 옮긴다. agent도 그 기계의 것으로 맞춘다: lophn(`lophn_<project>`)은
 * project마다 id가 달라 그 기계의 사본 project의 lophn으로 바꾸고, 그 밖의 agent(내장 coding agent, 정의 file의 agent)는 그 기계가
 * 알면 그대로 쓰고 모르면 그 기계의 lophn으로 떨어진다(더 단순하고, 말이 엉뚱한 agent로 가지 않는다). 그 기계가 읽히지 않으면
 * 탭을 건드리지 않는다. 쓰던 글은 새 draft key로 옮긴다.
 */
async function rebindToCopy(
  tab: TabItem,
  host: TabHost,
  copy: ProjectCopy,
): Promise<void> {
  const agent = agentOf(tab);
  const from = workspaceOf(tab);
  if (agent === null || from === null || sessionOf(tab) !== null) return;
  const to = { kind: "project", id: copy.project } as const;
  const lophn = `lophn_${copy.project}`;
  const faceOn = (assignment: string) =>
    host
      .machineData(copy.machine)
      .agentViewSource({ assignment, workspace: to })
      .agent();
  let next = isLophn(agent) ? lophn : agent;
  let face = await faceOn(next);
  if (!face.ok && next !== lophn) {
    next = lophn;
    face = await faceOn(next);
  }
  if (!face.ok) return;
  const old = await factoryOf(
    tab,
    host,
  )?.({
    assignment: agent,
    workspace: sourceWorkspaceOf(from),
  }).agent();
  const drafts = host.agentView?.drafts;
  if (drafts !== undefined && old?.ok === true) {
    const oldKey = newSessionKey(old.value);
    const newKey = newSessionKey(face.value);
    const held = drafts.draft(oldKey);
    if (oldKey !== newKey && drafts.draft(newKey).text === "") {
      drafts.save(newKey, {
        text: held.text,
        selection: held.selection,
        attachments: held.attachments,
      });
      drafts.save(oldKey, { text: "", selection: [0, 0], attachments: [] });
    }
  }
  // 탭의 기계 칸은 workspace의 기계와 다를 때만 둔다(없으면 workspace의 기계다).
  host.patchTab(tab.key, (current) => ({
    machine: copy.machine === host.machine ? undefined : copy.machine!,
    fields: { ...current.fields, agent: next, workspace: copy.project },
  }));
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
    openConnections: slice.openConnections,
    desktop: desktopParts,
  };
}

// 그려지는 탭은 각 칸에서 고른 탭뿐이라 마운트가 곧 보임이다.
function ReportVisible({ session }: { session: string | null }) {
  useReportVisible(session);
  return null;
}

// 다른 기계의 session에서 agent가 `tab show`로 browser page를 폈다(`TabShowRequested`). 그 기계에 화면이 없을 수 있어, 이 session을
// 보는 이 창이 그 page의 원격 보기 탭을 연다. 이 컴퓨터의 session은 shell main이 host link의 tab_show로 펴므로 듣지 않는다.
function ShowRemotePages({
  session,
  machine,
  host,
}: {
  session: string;
  machine: string;
  host: TabHost;
}) {
  const client = useEventClient();
  // host는 그릴 때마다 새 값이라 구독을 다시 걸지 않게 ref로 든다.
  const latest = useRef(host);
  latest.current = host;
  useEffect(
    () =>
      client.subscribe({ types: ["TabShowRequested"] }, (message) => {
        if (
          message.kind === "event" &&
          message.event.type === "TabShowRequested" &&
          message.event.subject === session
        ) {
          openPage(latest.current, machine, message.event.payload.tab);
        }
      }),
    [client, session, machine],
  );
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
      <AgentFaceIcon face={{ kind: "lophn", profile }} />
    );
  },
  dotOf: (tab, host) => host.agentView?.dotOf(sessionOf(tab)) ?? null,
  // 탭 이름은 lophn session 제목이다. session 제목은 비울 수 없어 빈 이름은 무시한다.
  rename(tab, name, host) {
    const trimmed = name?.trim();
    const session = sessionOf(tab);
    const agent = agentOf(tab);
    const workspace = workspaceOf(tab);
    if (!trimmed || session === null || agent === null || workspace === null) {
      return;
    }
    const source = factoryOf(
      tab,
      host,
    )?.({
      assignment: agent,
      workspace: sourceWorkspaceOf(workspace),
    });
    if (source === undefined) return;
    void source
      .act(session, {
        type: "rename",
        session,
        key: newId("rename"),
        title: trimmed,
      })
      .then((result) => {
        if (!result.ok) return;
        // 창의 session 제목도 같이 고친다. 탭만 고치면 옛 제목을 아는 창이 탭을 되돌린다.
        host.agentView?.titled(session, trimmed);
        host.patchTab(tab.key, () => ({ title: trimmed }));
      });
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
    const workspace = workspaceOf(tab);
    if (agent === null || workspace === null) return null;
    const own = host.agentView;
    if (own === null) return <AgentNotReady />;
    // 다른 workspace에서 온 탭(전역 float)은 이 workspace의 agent로 바꾸어 읽지 않는다. 기계를 단 탭은 그 기계의 workspace다.
    if (tab.machine === undefined && workspace !== fieldOf(host.workspace)) {
      return null;
    }
    const machine = tab.machine ?? host.machine;
    const session = sessionOf(tab);
    const slice =
      tab.machine === undefined
        ? own
        : { ...own, factory: host.machineData(tab.machine).agentViewSource };
    return (
      <>
        <ReportVisible session={sessionOf(tab)} />
        {machine === null || session === null ? null : (
          <ShowRemotePages session={session} machine={machine} host={host} />
        )}
        <AgentTab
          key={`${tab.key}|${tab.machine ?? ""}|${workspace}`}
          agent={agent}
          workspace={workspace === HOME ? null : workspace}
          machine={tab.machine ?? host.machine}
          workspaceMachine={host.machine}
          onRebind={(copy) => void rebindToCopy(tab, host, copy)}
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
