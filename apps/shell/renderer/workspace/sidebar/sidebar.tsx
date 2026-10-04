import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type IconProps,
  Tooltip,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { ContextRow, DocumentRow, ProjectView } from "../source.ts";
import { LauncherButton } from "../launcher-button.tsx";
import styles from "./sidebar.module.css";

export interface SidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  project: ProjectView | null;
  documents: readonly DocumentRow[];
  contexts: readonly ContextRow[];
  /** focus 칸의 활성 탭. 그 문서 행을 고른 행으로 보인다. */
  current?: string | null;
  /** 런처로 돌아간다(desktop#R26). 접힘 때는 상단 바가 대신한다. */
  onLauncher: () => void;
  /** 접힘을 사람이 바꾼다. */
  onToggle: () => void;
  /** 문서 행을 눌러 탭을 연다. */
  onOpenDocument: (document: DocumentRow) => void;
  /** 오른쪽 가장자리 drag로 폭을 바꾼다. 열렸을 때만 준다. */
  onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void;
}

// 작업대 sidebar. 프로젝트 폴더·문서·연관 컨텍스트만 보인다(desktop#R28).
export function Sidebar(
  {
    mode,
    width,
    project,
    documents,
    contexts,
    current = null,
    onLauncher,
    onToggle,
    onOpenDocument,
    onResizeStart,
  }: SidebarProps,
) {
  if (mode === "hidden") return null;
  const collapsed = mode === "collapsed";
  const toggleLabel = collapsed
    ? t("project-workspace.button.expand-sidebar")
    : t("project-workspace.button.collapse-sidebar");
  return (
    <nav
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}
      data-sidebar={mode}
      style={{ width: `${width}px` }}
      aria-label={t("project-workspace.sidebar.label")}
    >
      <div className={styles.header}>
        {collapsed ? null : (
          <span className={styles.headerContent}>
            <LauncherButton onLauncher={onLauncher} />
            <span className={styles.title} data-project-title="">
              {project?.title ?? ""}
            </span>
          </span>
        )}
        <Tooltip content={toggleLabel}>
          <IconButton
            icon={workspaceIcons.sidebar}
            label={toggleLabel}
            data-sidebar-toggle=""
            aria-expanded={!collapsed}
            onClick={onToggle}
          />
        </Tooltip>
      </div>
      <div className={styles.body}>
        <Section
          id="folders"
          label={t("project-workspace.heading.folders")}
          collapsed={collapsed}
          empty={t("project-workspace.empty.no-folders")}
        >
          {(project?.folders ?? []).map((folder) => (
            <Row
              key={folder.path}
              data={{ "data-folder": "" }}
              icon={workspaceIcons.folder}
              label={folderName(folder.path)}
              hint={folder.path}
              collapsed={collapsed}
            />
          ))}
        </Section>
        <Section
          id="documents"
          label={t("project-workspace.heading.documents")}
          collapsed={collapsed}
          empty={t("project-workspace.empty.no-documents")}
        >
          {documents.map((document) => (
            <Row
              key={document.id}
              data={{ "data-document": document.id }}
              icon={workspaceIcons.document}
              label={document.title}
              collapsed={collapsed}
              active={document.id === current}
              onClick={() => onOpenDocument(document)}
            />
          ))}
        </Section>
        <Section
          id="contexts"
          label={t("project-workspace.heading.contexts")}
          collapsed={collapsed}
          empty={t("project-workspace.empty.no-contexts")}
        >
          {contexts.map((context) => (
            <Row
              key={context.id}
              data={{ "data-context": "" }}
              icon={workspaceIcons.context}
              label={context.title}
              collapsed={collapsed}
            />
          ))}
        </Section>
      </div>
      {onResizeStart && !collapsed
        ? (
          <div
            className={styles.resizer}
            data-sidebar-resizer=""
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onResizeStart}
          />
        )
        : null}
    </nav>
  );
}

// 경로의 마지막 이름. 전체 경로는 hint로 둔다.
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

interface SectionProps {
  id: string;
  label: string;
  collapsed: boolean;
  empty: string;
  children: ReactNode[];
}

function Section({ id, label, collapsed, empty, children }: SectionProps) {
  return (
    <section className={styles.section} data-section={id}>
      {collapsed ? null : <h2 className={styles.sectionLabel}>{label}</h2>}
      {children.length > 0
        ? <ul className={styles.list} role="list">{children}</ul>
        : collapsed
        ? null
        : <p className={styles.empty}>{empty}</p>}
    </section>
  );
}

interface RowProps {
  icon: IconProps["icon"];
  label: string;
  hint?: string;
  collapsed: boolean;
  active?: boolean;
  data: Record<string, string>;
  onClick?: () => void;
}

// 32px 행: 16px 아이콘, 8px 간격, 이름. 접힘 때는 아이콘만 두고 이름은 tooltip으로 보인다.
function Row(
  { icon, label, hint, collapsed, active = false, data, onClick }: RowProps,
) {
  const inner = (
    <>
      <Icon
        icon={icon}
        pixels={iconPixels("base")}
        className={styles.icon}
      />
      {collapsed ? null : <span className={styles.label}>{label}</span>}
    </>
  );
  const className = `${styles.item} ${active ? styles.active : ""}`;
  const row = onClick
    ? (
      <button
        type="button"
        {...data}
        className={className}
        aria-label={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        title={hint}
        onClick={onClick}
      >
        {inner}
      </button>
    )
    : (
      <span
        {...data}
        className={className}
        aria-label={collapsed ? label : undefined}
        title={hint}
      >
        {inner}
      </span>
    );
  return (
    <li className={styles.li}>
      {collapsed ? <Tooltip content={label}>{row}</Tooltip> : row}
    </li>
  );
}
