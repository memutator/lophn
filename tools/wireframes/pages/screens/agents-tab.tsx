// workspace(project, Home, 앱)의 Agents 탭과 agent 설정 탭. 화면은 renderer의 workspace/agents가 그리고, 여기서는 project 창(ProjectApp)이
// 부르는 이름으로 fake source에 이어 준다. 정의는 project 폴더가 아니라 lophn에 저장된다.
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { CHANGE_NAMES } from "../../../../packages/protocol/events/changes.ts";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { AgentsPage } from "../../../../packages/shell/renderer/workspace/agents/agents-page.tsx";
import { AgentsTabs } from "../../../../packages/shell/renderer/workspace/agents/tab-state.ts";
import { AgentEditor } from "../../../../packages/shell/renderer/workspace/agents/editor/agent-editor.tsx";
import {
  APP_ID,
  APP_NAME,
  createFakeAgentsSource,
  FAKE_AGENTS,
  type FakeAgentsOptions,
  PROJECT_ID,
  PROJECT_NAME,
} from "../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { runSteps, type Step, useDrive } from "../../mock/drive.ts";
import type { TabSpec } from "./project-window.tsx";

export const AGENTS_TAB_SPEC: TabSpec = {
  key: "agents",
  kind: "agents",
  title: `${PROJECT_NAME} · Agents`,
};

/** Agents 탭을 보일 자리. 이름은 fake source가 가진 것과 같다. */
export type AgentsAt = "project" | "home" | "app";
const AT: Record<AgentsAt, { workspace: string; name: string }> = {
  project: { workspace: PROJECT_ID, name: PROJECT_NAME },
  home: { workspace: "home", name: "Home" },
  app: { workspace: APP_ID, name: APP_NAME },
};

/** agent 설정 화면을 여는 탭. 새 agent는 id가 "new"다. */
export function agentTab(id: string): TabSpec {
  return {
    key: `agent-edit:${id}`,
    kind: "agent-settings",
    title: FAKE_AGENTS.find((agent) => agent.key === id)?.name ?? "New agent",
    sub: id,
  };
}

const noop = () => {};

/**
 * 화면은 core의 변경 알림으로 다시 읽는다. fake agents source가 바뀌면 모든 이름의 `StateChanged`를 흘려 그 길을 따른다.
 */
export function FakeAgentEvents({
  source,
  children,
}: {
  source: ReturnType<typeof createFakeAgentsSource>;
  children: ReactNode;
}) {
  const [fake] = useState(() => createFakeSource());
  const [client] = useState(() => createEventClient(fake));
  useEffect(
    () =>
      source.changed(() =>
        fake.emitEvent({
          type: "StateChanged",
          subject: null,
          at: new Date().toISOString(),
          payload: {
            changes: CHANGE_NAMES.map((name) => ({ name, id: null })),
          },
        }),
      ),
    [source, fake],
  );
  return <EventsProvider client={client}>{children}</EventsProvider>;
}

/** workspace의 Agents 탭. 카드의 [Open]은 같은 탭 안에서 editor로 바뀌고 위쪽 ← →가 목록과 연 agent 사이를 오간다. */
export function AgentsBody({
  at = "project",
  source: options,
  steps = [],
}: {
  at?: AgentsAt;
  source?: FakeAgentsOptions;
  /** gallery가 상태를 고정하려고 mount 뒤에 누를 것. */
  steps?: readonly Step[];
}) {
  const source = useMemo(() => createFakeAgentsSource(options), []);
  const tabs = useMemo(() => new AgentsTabs(), []);
  useDrive(() => runSteps(steps));
  return (
    <FakeAgentEvents source={source}>
      <AgentsPage
        workspace={AT[at].workspace}
        workspaceName={AT[at].name}
        source={source}
        tabKey="agents"
        tabs={tabs}
        agent={null}
        onAgent={noop}
        askLeave={() => Promise.resolve(true)}
        onAddExtension={noop}
      />
    </FakeAgentEvents>
  );
}

/** agent 하나의 설정 탭. id가 "new"면 새 agent다. steps는 gallery가 상태를 고정하려고 mount 뒤에 누를 것이다. */
export function AgentSettingsEditor({
  id,
  workspace = "project",
  onDone,
  steps = [],
  source: options,
}: {
  id: string;
  /** 화면을 연 자리다. `app`이면 앱 그릇의 skill·MCP를 그린다. */
  workspace?: AgentsAt;
  onDone: () => void;
  steps?: readonly Step[];
  /** provider와 workspace 층 model의 상태. */
  source?: FakeAgentsOptions;
}) {
  const source = useMemo(() => createFakeAgentsSource(options), []);
  useDrive(() => runSteps(steps));
  return (
    <FakeAgentEvents source={source}>
      <div>
        <AgentEditor
          source={source}
          workspace={AT[workspace].workspace}
          workspaceName={AT[workspace].name}
          agent={id === "new" ? null : id}
          onDone={onDone}
        />
      </div>
    </FakeAgentEvents>
  );
}
