// Lophn Workspace › Settings 틀. 세로 nav(General, Providers, Agents, Tools and skills, Coding agents,
// Reactions, Diagnostics)와 고른 항목. Providers와 Agents 본문은 workspace-settings.tsx의 것을 쓰고,
// 나머지는 이 폴더의 panel이다. 어느 항목이든 `panes`로 바꿔 끼울 수 있다.
import type { ReactNode } from "react";

import { AgentsPane, ProvidersPane } from "../workspace-settings.tsx";
import a from "../agents.module.css";
import c from "../compose.module.css";
import { CodingPane } from "./coding-pane.tsx";
import { DiagnosticsPane } from "./diagnostics-pane.tsx";
import { GeneralPane } from "./general-pane.tsx";
import { ReactionsPane } from "./reactions-pane.tsx";
import styles from "./workspace.module.css";

export type WorkspacePane =
  | "general"
  | "providers"
  | "agents"
  | "tools"
  | "coding"
  | "reactions"
  | "diagnostics";

const WORKSPACE_PANES: readonly {
  readonly id: WorkspacePane;
  readonly label: string;
}[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "agents", label: "Agents" },
  { id: "tools", label: "Tools and skills" },
  { id: "coding", label: "Coding agents" },
  { id: "reactions", label: "Reactions" },
  { id: "diagnostics", label: "Diagnostics" },
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

export function SettingsShell(
  { pane, onPane, onConnect, panes = {} }: {
    pane: WorkspacePane;
    onPane: (pane: WorkspacePane) => void;
    onConnect: (provider: string) => void;
    panes?: PaneOverrides;
  },
) {
  return (
    <div className={a.settings}>
      <nav className={a.setNav} aria-label="Settings">
        {WORKSPACE_PANES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={a.setNavItem}
            aria-current={item.id === pane ? "page" : undefined}
            onClick={() => onPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={`${a.setBody} ${styles.centered}`}>
        {panes[pane] ?? <PaneBody pane={pane} onConnect={onConnect} />}
      </div>
    </div>
  );
}
