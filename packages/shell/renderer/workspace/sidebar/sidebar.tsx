import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useState,
} from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type IconProps,
  Tooltip,
} from "@lophn/design/components";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { DocumentRow, FileRow, ProjectView } from "../source.ts";
import { LauncherButton } from "../launcher-button.tsx";
import { CONTEXTS_TAB_KEY } from "../kinds/contexts.tsx";
import { type RailAction, ShortcutRail } from "../contexts/shortcut-rail.tsx";
import { AgentsSection, type AgentsSectionProps } from "./agents-section.tsx";
import styles from "./sidebar.module.css";

export interface SidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  project: ProjectView | null;
  documents: readonly DocumentRow[];
  /** 문서로 잡힌 파일. 폴더 행을 펼치면 그 폴더 아래 문서로 보인다. */
  files?: readonly FileRow[];
  /** focus 칸의 활성 탭. 그 문서 행을 고른 행으로 보인다. */
  current?: string | null;
  /** 런처로 돌아간다(desktop#R26). 접힘 때는 상단 바가 대신한다. */
  onLauncher: () => void;
  /** 접힘을 사람이 바꾼다. */
  onToggle: () => void;
  /** 문서 행을 눌러 탭을 연다. */
  onOpenDocument: (document: DocumentRow) => void;
  /** Contexts 행을 눌러 Contexts 탭을 연다(workspace#R31). 없으면 행을 두지 않는다. */
  onOpenContexts?: () => void;
  /** Agents 묶음(workspace#R34). 없으면 묶음을 두지 않는다. */
  agents?: AgentsSectionProps;
  /** 접힌 sidebar의 바로 가기 rail 단추(workspace#R32). 없으면 접힌 sidebar에는 접기 단추만 있다. */
  onRail?: (action: RailAction) => void;
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
    files = [],
    current = null,
    onLauncher,
    onToggle,
    onOpenDocument,
    onOpenContexts,
    agents,
    onRail,
    onResizeStart,
  }: SidebarProps,
) {
  // 고른 폴더와 펼친 폴더는 화면 상태일 뿐이라 저장하지 않는다.
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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
      {collapsed
        ? onRail ? <ShortcutRail onOpen={onRail} /> : null
        : (
          <div className={styles.body}>
            <Section
              id="folders"
              label={t("project-workspace.heading.folders")}
              empty={t("project-workspace.empty.no-folders")}
            >
              {(project?.folders ?? []).flatMap((folder) => {
                const open = expanded.has(folder.path);
                const inside = files.filter((file) =>
                  file.folder === folder.path
                );
                const rows = [
                  <Row
                    key={folder.path}
                    data={{ "data-folder": "" }}
                    icon={workspaceIcons.folder}
                    label={folderName(folder.path)}
                    hint={folder.path}
                    active={folder.path === selectedFolder}
                    expanded={open}
                    onClick={() => {
                      setSelectedFolder(folder.path);
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (!next.delete(folder.path)) next.add(folder.path);
                        return next;
                      });
                    }}
                  />,
                ];
                if (!open) return rows;
                if (inside.length === 0) {
                  rows.push(
                    <li key={`${folder.path}:empty`} className={styles.li}>
                      <p className={`${styles.empty} ${styles.nested}`}>
                        {t("project-workspace.empty.no-folder-documents")}
                      </p>
                    </li>,
                  );
                }
                for (const file of inside) {
                  rows.push(
                    <Row
                      key={`${folder.path}:${file.document}`}
                      data={{ "data-folder-document": file.document }}
                      icon={workspaceIcons.document}
                      label={file.title}
                      hint={file.path}
                      nested
                      active={file.document === current}
                      onClick={() =>
                        onOpenDocument({
                          id: file.document,
                          title: file.title,
                        })}
                    />,
                  );
                }
                return rows;
              })}
            </Section>
            <Section
              id="documents"
              label={t("project-workspace.heading.documents")}
              empty={t("project-workspace.empty.no-documents")}
            >
              {documents.map((document) => (
                <Row
                  key={document.id}
                  data={{ "data-document": document.id }}
                  icon={workspaceIcons.document}
                  label={document.title}
                  active={document.id === current}
                  onClick={() => onOpenDocument(document)}
                />
              ))}
            </Section>
            {onOpenContexts
              ? (
                <section className={styles.section} data-section="contexts">
                  <ul className={styles.list} role="list">
                    <Row
                      data={{ "data-contexts-row": "" }}
                      icon={workspaceIcons.context}
                      label={t("contexts.label.rail-contexts")}
                      active={current === CONTEXTS_TAB_KEY}
                      onClick={onOpenContexts}
                    />
                  </ul>
                </section>
              )
              : null}
            {agents ? <AgentsSection {...agents} /> : null}
          </div>
        )}
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
  empty: string;
  children: ReactNode[];
}

function Section({ id, label, empty, children }: SectionProps) {
  return (
    <section className={styles.section} data-section={id}>
      <h2 className={styles.sectionLabel}>{label}</h2>
      {children.length > 0
        ? <ul className={styles.list} role="list">{children}</ul>
        : <p className={styles.empty}>{empty}</p>}
    </section>
  );
}

interface RowProps {
  icon: IconProps["icon"];
  label: string;
  hint?: string;
  active?: boolean;
  /** 폴더 행의 펼침. 값이 있으면 aria-expanded로 알린다. */
  expanded?: boolean;
  /** 폴더 아래 문서 행. 안쪽으로 들여 쓴다. */
  nested?: boolean;
  data: Record<string, string>;
  onClick?: () => void;
}

// 32px 행: 16px 아이콘, 8px 간격, 이름.
function Row(
  {
    icon,
    label,
    hint,
    active = false,
    expanded,
    nested = false,
    data,
    onClick,
  }: RowProps,
) {
  const inner = (
    <>
      <Icon
        icon={icon}
        pixels={iconPixels("base")}
        className={styles.icon}
      />
      <span className={styles.label}>{label}</span>
    </>
  );
  const className = `${styles.item} ${active ? styles.active : ""} ${
    nested ? styles.nested : ""
  }`;
  const row = onClick
    ? (
      <button
        type="button"
        {...data}
        className={className}
        aria-current={active ? "page" : undefined}
        aria-expanded={expanded}
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
        title={hint}
      >
        {inner}
      </span>
    );
  return <li className={styles.li}>{row}</li>;
}
