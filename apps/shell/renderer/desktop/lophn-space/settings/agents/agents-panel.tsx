import type { ReactNode } from "react";

import type { AgentsSettingsSource } from "./settings-source.ts";

export interface AgentsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Agents(shell/desktop#R50). 모든 project에 적용되는 기본값이고 project나 Operator가
// 바꾸지 않은 칸이 따르는 값이다. 위에서 아래로 Default models(lophn·Context Engineer·App Engineer·
// Operators 넷, 줄마다 model과 option 값과 [Change]), Model for summaries(한 줄), Instructions for
// all projects(LOPHN.md 미리보기와 [Edit]), Skills (all projects)([Add skill]), MCP servers
// (all projects)([Add server]) 순이다. [Change]는 그 줄 아래에 model 목록과 고른 model의
// option 축을 여는 editor를 하나만 연다. General에는 Models·Instructions 칸이 없다.
// agent-I30
export function AgentsPanel(_props: AgentsPanelProps): ReactNode {
  throw new Error("not implemented: agent-I30");
}
