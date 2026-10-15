// project의 Agents 탭과 agent 설정 탭. 화면은 agent-setup/에 있고, 여기서는 project 창(ProjectApp)이 부르는
// 이름으로 이어 준다. 정의는 project 폴더가 아니라 lophn에 저장된다.
import { AgentEditor } from "./agent-setup/agent-editor.tsx";
import { ProjectAgentsBody } from "./agent-setup/project-agents-tab.tsx";
import type { TabSpec } from "./project-window.tsx";

type Open = (tab: TabSpec, other?: boolean) => void;

/** project의 Agents 탭. */
export function AgentsBody({ open }: { open: Open }) {
  return <ProjectAgentsBody open={open} />;
}

/** agent 하나의 설정 탭. id가 "new"면 새 Operator다. */
export function OperatorEditor(
  { id, onDone }: { id: string; onDone: () => void },
) {
  return <AgentEditor id={id} onDone={onDone} />;
}
