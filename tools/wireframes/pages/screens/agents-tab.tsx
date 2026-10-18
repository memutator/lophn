// project의 Agents 탭과 agent 설정 탭. 화면은 renderer의 workspace/agents가 그리고, 여기서는 project 창(ProjectApp)이 부르는
// 이름으로 fake source에 이어 준다. 정의는 project 폴더가 아니라 lophn에 저장된다.
import { useMemo } from "react";

import { AgentsPage } from "../../../../packages/shell/renderer/workspace/agents/agents-page.tsx";
import { AgentEditor } from "../../../../packages/shell/renderer/workspace/agents/editor/agent-editor.tsx";
import {
  APP_ID,
  createFakeAgentsSource,
  FAKE_AGENTS,
  type FakeAgentsOptions,
  PROJECT_CONTEXTS,
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

/** agent 설정 화면을 여는 탭. 새 Operator는 id가 "new"다. */
export function agentTab(id: string): TabSpec {
  return {
    key: `agent-edit:${id}`,
    kind: "operator",
    title: FAKE_AGENTS.find((agent) => agent.key === id)?.name ??
      "New Operator",
    sub: id,
  };
}

const noop = () => {};

/** project의 Agents 탭. 카드의 Open은 agent 설정 탭을 따로 연다. */
export function AgentsBody({ open }: { open: Open }) {
  const source = useMemo(() => createFakeAgentsSource(), []);
  return (
    <AgentsPage
      project={PROJECT_ID}
      projectName={PROJECT_NAME}
      source={source}
      agent={null}
      onAgent={(key) => {
        if (key !== null) open(agentTab(key));
      }}
      contexts={PROJECT_CONTEXTS}
      onEditInstructions={noop}
      onAddExtension={noop}
      onChanged={noop}
    />
  );
}

/** agent 하나의 설정 탭. id가 "new"면 새 Operator다. steps는 gallery가 상태를 고정하려고 mount 뒤에 누를 것이다. */
export function OperatorEditor(
  { id, onDone, steps = [], source: options }: {
    id: string;
    onDone: () => void;
    steps?: readonly Step[];
    /** provider와 project 층 model의 상태. */
    source?: FakeAgentsOptions;
  },
) {
  const source = useMemo(() => createFakeAgentsSource(options), []);
  useDrive(() => runSteps(steps));
  return (
    <div>
      <AgentEditor
        source={source}
        project={id === "app_engineer" ? APP_ID : PROJECT_ID}
        projectName={PROJECT_NAME}
        agent={id === "new" ? null : id}
        contexts={PROJECT_CONTEXTS}
        onDone={onDone}
        onChanged={noop}
        onEditProjectInstructions={noop}
      />
    </div>
  );
}
