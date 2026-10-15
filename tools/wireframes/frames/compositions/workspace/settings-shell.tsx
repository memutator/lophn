// Lophn Workspace › Settings 틀. 항목 목록(General, Providers, Agents, Tools and skills, Coding agents,
// Reactions, Diagnostics)은 sidebar의 Settings 아래에 들여 쓰고, 이 틀은 고른 항목의 본문만 그린다. Providers와 Agents 본문은 workspace-settings.tsx의 것을 쓰고,
// 나머지는 이 폴더의 panel이다. 어느 항목이든 `panes`로 바꿔 끼울 수 있다.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Palette,
  Plug,
  SlidersHorizontal,
  SquareTerminal,
  Wrench,
  Zap,
} from "lucide-react";

import { AgentsPane, ProvidersPane } from "../workspace-settings.tsx";
import a from "../agents.module.css";
import c from "../compose.module.css";
import { CodingPane } from "./coding-pane.tsx";
import { AppearancePane } from "./appearance-pane.tsx";
import { DiagnosticsPane } from "./diagnostics-pane.tsx";
import { GeneralPane } from "./general-pane.tsx";
import { ReactionsPane } from "./reactions-pane.tsx";
import styles from "./workspace.module.css";

export type WorkspacePane =
  | "general"
  | "appearance"
  | "providers"
  | "agents"
  | "tools"
  | "coding"
  | "reactions"
  | "diagnostics";

export interface WorkspacePaneEntry {
  readonly id: WorkspacePane;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** sidebar의 Settings 아래에 묶음 이름과 함께 놓이는 항목. */
export const WORKSPACE_PANE_GROUPS: readonly {
  readonly title: string;
  readonly panes: readonly WorkspacePaneEntry[];
}[] = [
  {
    title: "General",
    panes: [
      { id: "general", label: "General", icon: SlidersHorizontal },
      { id: "appearance", label: "Appearance", icon: Palette },
    ],
  },
  {
    title: "Agents",
    panes: [
      { id: "providers", label: "Providers", icon: Plug },
      { id: "agents", label: "Agents", icon: Bot },
      { id: "tools", label: "Tools and skills", icon: Wrench },
      { id: "coding", label: "Coding agents", icon: SquareTerminal },
    ],
  },
  {
    title: "System",
    panes: [
      { id: "reactions", label: "Reactions", icon: Zap },
      { id: "diagnostics", label: "Diagnostics", icon: Activity },
    ],
  },
];

/** nav의 항목을 고르는 칸에 다른 본문을 넣는 칸. */
export type PaneOverrides = Partial<Record<WorkspacePane, ReactNode>>;

function ToolsPlaceholder() {
  return (
    <div className={a.setPage}>
      <h1 className={c.searchTitle}>Tools and skills</h1>
      <p className={a.setLead}>
        Not part of this wireframe. Nothing changes here.
      </p>
    </div>
  );
}

function PaneBody(
  { pane, onConnect }: {
    pane: WorkspacePane;
    onConnect: (provider: string) => void;
  },
) {
  switch (pane) {
    case "general":
      return <GeneralPane />;
    case "appearance":
      return <AppearancePane />;
    case "providers":
      return <ProvidersPane onConnect={onConnect} />;
    case "agents":
      return <AgentsPane />;
    case "tools":
      return <ToolsPlaceholder />;
    case "coding":
      return <CodingPane />;
    case "reactions":
      return <ReactionsPane />;
    case "diagnostics":
      return <DiagnosticsPane />;
  }
}

/** Settings 본문. 항목 목차는 Workspace sidebar의 Settings 아래에 있다. */
export function SettingsShell(
  { pane, onConnect, panes = {} }: {
    pane: WorkspacePane;
    onConnect: (provider: string) => void;
    panes?: PaneOverrides;
  },
) {
  return (
    <div className={a.settings}>
      <div className={`${a.setBody} ${styles.centered}`}>
        {panes[pane] ?? <PaneBody pane={pane} onConnect={onConnect} />}
      </div>
    </div>
  );
}
