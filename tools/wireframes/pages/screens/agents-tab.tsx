// workspace(project, Home, 앱)의 Agents 탭과 agent 설정 탭. 화면은 renderer의 workspace/agents가 그리고, 여기서는 project 창(ProjectApp)이
// 부르는 이름으로 fake source에 이어 준다. 정의는 project 폴더가 아니라 lophn에 저장된다.
import { useMemo } from "react";

import { AgentsPage } from "../../../../packages/shell/renderer/workspace/agents/agents-page.tsx";
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

type Open = (tab: TabSpec, other?: boolean) => void;

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

/** workspace의 Agents 탭. 카드의 Open은 agent 설정 탭을 따로 연다. */
export function AgentsBody({
  open,
  at = "project",
  source: options,
  steps = [],
}: {
  open: Open;
  at?: AgentsAt;
  source?: FakeAgentsOptions;
  /** gallery가 상태를 고정하려고 mount 뒤에 누를 것. */
  steps?: readonly Step[];
}) {
  const source = useMemo(() => createFakeAgentsSource(options), []);
  useDrive(() => runSteps(steps));
  return (
    <AgentsPage
      workspace={AT[at].workspace}
      workspaceName={AT[at].name}
      source={source}
      agent={null}
      onAgent={(key) => {
        if (key !== null) open(agentTab(key));
      }}
      onAddExtension={noop}
      onChanged={noop}
    />
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
    <div>
      <AgentEditor
        source={source}
        workspace={AT[workspace].workspace}
        workspaceName={AT[workspace].name}
        agent={id === "new" ? null : id}
        onDone={onDone}
        onChanged={noop}
      />
    </div>
  );
}
