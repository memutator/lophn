import { t } from "@lophn/wording";

import type { ContextRow, DocumentRow, ProjectView } from "../source.ts";
import styles from "./sidebar.module.css";

export interface SidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  project: ProjectView | null;
  documents: readonly DocumentRow[];
  contexts: readonly ContextRow[];
  /** 런처로 돌아간다(desktop#R26). 접힘 때는 상단 바가 대신한다. */
  onLauncher: () => void;
  /** 접힘을 사람이 바꾼다. */
  onToggle: () => void;
  /** 문서 행을 눌러 탭을 연다. */
  onOpenDocument: (document: DocumentRow) => void;
}

// 작업대 sidebar. 프로젝트 폴더·문서·연관 컨텍스트만 보인다(desktop#R28).
export function Sidebar(
  {
    mode,
    width,
    project,
    documents,
    contexts,
    onLauncher,
    onToggle,
    onOpenDocument,
  }: SidebarProps,
) {
  if (mode === "hidden") return null;
  const collapsed = mode === "collapsed";
  return (
    <nav
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}
      data-sidebar={mode}
      style={{ width: `${width}px` }}
      aria-label={t("project-workspace.sidebar.label")}
    >
      <div className={styles.head}>
        {collapsed ? null : (
          <button
            type="button"
            className={styles.back}
            data-launcher-back=""
            onClick={onLauncher}
          >
            {t("project-workspace.button.launcher")}
          </button>
        )}
        <button
          type="button"
          className={styles.toggle}
          data-sidebar-toggle=""
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed
            ? t("project-workspace.button.expand-sidebar")
            : t("project-workspace.button.collapse-sidebar")}
        </button>
      </div>
      <div className={styles.sections}>
        <section className={styles.section} data-section="folders">
          <h2 className={styles.heading}>
            {t("project-workspace.heading.folders")}
          </h2>
          {project && project.folders.length > 0
            ? project.folders.map((folder) => (
              <div key={folder.path} className={styles.row} data-folder="">
                {folder.path}
              </div>
            ))
            : (
              <p className={styles.empty}>
                {t("project-workspace.empty.no-folders")}
              </p>
            )}
        </section>
        <section className={styles.section} data-section="documents">
          <h2 className={styles.heading}>
            {t("project-workspace.heading.documents")}
          </h2>
          {documents.length > 0
            ? documents.map((document) => (
              <button
                key={document.id}
                type="button"
                className={styles.row}
                data-document={document.id}
                onClick={() => onOpenDocument(document)}
              >
                {document.title}
              </button>
            ))
            : (
              <p className={styles.empty}>
                {t("project-workspace.empty.no-documents")}
              </p>
            )}
        </section>
        <section className={styles.section} data-section="contexts">
          <h2 className={styles.heading}>
            {t("project-workspace.heading.contexts")}
          </h2>
          {contexts.length > 0
            ? contexts.map((context) => (
              <div key={context.id} className={styles.row} data-context="">
                {context.title}
              </div>
            ))
            : (
              <p className={styles.empty}>
                {t("project-workspace.empty.no-contexts")}
              </p>
            )}
        </section>
      </div>
    </nav>
  );
}
