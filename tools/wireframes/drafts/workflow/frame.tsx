// gallery 전용 틀: activity bar, panel 열, 탭 줄과 본문을 한 창으로 보인다. renderer로 옮기지 않는다.
// 실제 sidebar가 아직 activity bar가 아니라서 ProjectSidebar를 쓰지 않고 같은 조각(TopBar, Breadcrumbs, TabStrip, Explorer)으로 세운다.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Workflow } from "lucide-react";

import { TopBar } from "../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { Breadcrumbs } from "../../../../packages/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import {
  type TabItem,
  TabStrip,
} from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import { Explorer } from "../../../../packages/shell/renderer/workspace/sidebar/explorer.tsx";
import {
  FAKE_NOTES_FOLDER,
  FAKE_PROJECT_FOLDER,
  fakeWorkspaceSource,
} from "../../../../packages/shell/renderer/workspace/fake-source.ts";
import {
  artifactIcons,
  commonIcons,
  conversationIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import paneStyles from "../../../../packages/shell/renderer/workspace/panes/panes.module.css";
import { click } from "../../mock/drive.ts";
import { ActivityBar, type ActivityItem } from "./activity-bar.tsx";
import styles from "./workflow.module.css";

export const ACTIVITY_ENTRIES: readonly ActivityItem[] = [
  { id: "explorer", label: "Explorer", icon: workspaceIcons.folder },
  { id: "agents", label: "Agents", icon: commonIcons.roles },
  { id: "artifacts", label: "Artifacts", icon: artifactIcons.kind },
  { id: "domains", label: "Domains", icon: commonIcons.series },
  { id: "workflows", label: "Workflows", icon: Workflow },
];

export const ACTIVITY_SHORTCUTS: readonly ActivityItem[] = [
  { id: "terminal", label: "Terminal", icon: workspaceIcons.terminal },
  { id: "agent", label: "Agent", icon: conversationIcons.dock },
  { id: "search", label: "Search", icon: paletteIcons.search },
];

const FOLDERS = [
  {
    path: FAKE_PROJECT_FOLDER,
    found: true,
    subfolders: [{ path: "eval" }],
  },
  { path: FAKE_NOTES_FOLDER, found: true, subfolders: [] },
];

const noop = () => {};

/** Explorer panel 본문. 실제 Explorer를 열어 둔 모양으로 세운다. */
export function ExplorerPanel() {
  const source = useMemo(() => fakeWorkspaceSource(), []);
  useEffect(() => {
    void (async () => {
      for (const dir of ["eval", "eval/experiments"]) {
        await click(
          `[data-file="${FAKE_PROJECT_FOLDER}/${dir}"][aria-expanded="false"]`,
        );
      }
    })().catch((error) => console.warn(error));
  }, []);
  return (
    <Explorer
      source={source}
      folders={FOLDERS}
      current={`${FAKE_PROJECT_FOLDER}/eval/experiments/exp-012-ftb-quests-021-q8.md`}
      onOpenFile={noop}
      onMove={(from, to) => source.rename(from, to)}
      onTrash={(path) => source.trash(path)}
    />
  );
}

/** 창 하나를 세우는 판의 바탕. 창이 둘이면 위아래로 나뉜다. */
export function Stage({ children }: { children: ReactNode }) {
  return <div className={styles.stage}>{children}</div>;
}

export function WorkflowFrame(
  {
    initialPanel,
    bodies,
    tabs,
    selected,
    crumbs,
    narrow = false,
    focusItem,
    children,
  }: {
    /** 처음 열려 있는 panel. null이면 접힌 모양이다. */
    initialPanel: string | null;
    /** panel마다의 본문. 없는 항목은 빈 panel이다. */
    bodies: Readonly<Record<string, ReactNode>>;
    tabs: readonly TabItem[];
    selected: string;
    crumbs: readonly string[];
    /** 창이 좁다(폭 640px). panel은 접혀 있고 본문 여백이 줄어든다. */
    narrow?: boolean;
    /** 이 항목에 focus를 줘서 tooltip을 연 채로 그린다. */
    focusItem?: string;
    children: ReactNode;
  },
) {
  const [last, setLast] = useState(initialPanel ?? "workflows");
  const [open, setOpen] = useState(initialPanel !== null);
  useEffect(() => {
    if (focusItem === undefined) return;
    document.querySelector<HTMLElement>(`[data-bar-item="${focusItem}"]`)
      ?.focus();
  }, []);
  const item = ACTIVITY_ENTRIES.find((entry) => entry.id === last)!;
  return (
    <div
      className={`${styles.window} ${narrow ? styles.windowSized : ""}`}
      style={narrow ? { width: "var(--page-form)" } : undefined}
    >
      <ActivityBar
        entries={ACTIVITY_ENTRIES}
        shortcuts={ACTIVITY_SHORTCUTS}
        selected={last}
        open={open}
        onSelect={(id) => {
          // 열린 항목을 다시 누르면 접고, 다른 항목을 누르면 그 panel을 연다.
          if (open && id === last) setOpen(false);
          else {
            setLast(id);
            setOpen(true);
          }
        }}
        onShortcut={noop}
      />
      {open
        ? (
          <aside className={styles.panel} aria-label={item.label}>
            <div className={styles.panelHead}>{item.label}</div>
            <div className={styles.panelBody}>{bodies[last] ?? null}</div>
          </aside>
        )
        : null}
      <div className={styles.main}>
        <TopBar
          platform="linux"
          leading={<Breadcrumbs crumbs={crumbs.map((label) => ({ label }))} />}
        />
        <section className={paneStyles.pane}>
          <TabStrip tabs={tabs} selected={selected} />
          <div
            className={`${paneStyles.body} ${narrow ? paneStyles.narrow : ""}`}
          >
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
