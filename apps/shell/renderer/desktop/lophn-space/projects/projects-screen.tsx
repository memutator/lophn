import { useEffect, useState } from "react";
import { ErrorState, Switch } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { Catalog, LophnSource } from "../source.ts";
import type { OrganizeSource, ProjectRow } from "../organize/source.ts";
import { DocumentPanel } from "../organize/document-panel.tsx";
import { ProjectDetail } from "./project-detail.tsx";
import listStyles from "../documents/documents.module.css";

export interface ProjectsScreenProps {
  source: OrganizeSource;
  /** 문서를 옮길 자리 선택지(프로젝트·앱). */
  lophn: LophnSource;
}

type Rows =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly rows: readonly ProjectRow[] };

const EMPTY_CATALOG: Catalog = { projects: [], apps: [], contexts: [] };

// projects 화면. 왼쪽 목록 칸에서 프로젝트를 고르고 오른쪽에서 이름·목적·보관과 소속 문서
// 정리·export를 한다(shell/desktop#R28, flow organize-documents의 사람 갈래). 기본 목록은 고를
// 대상과 필요한 상태만 보이고 폴더·추적 설정 같은 상세는 작업대에서 본다.
export function ProjectsScreen({ source, lophn }: ProjectsScreenProps) {
  const [rows, setRows] = useState<Rows>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [document, setDocument] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  // 문서가 옮겨지거나 파일이 생기면 프로젝트의 문서 목록을 다시 읽게 한다.
  const [documentsRevision, setDocumentsRevision] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all([source.projects(), lophn.catalog()]).then(
      ([read, places]) => {
        if (!live) return;
        setRows(
          read.ok ? { kind: "ready", rows: read.value } : { kind: "failed" },
        );
        if (places.ok) setCatalog(places.value);
      },
    );
    return () => {
      live = false;
    };
  }, [source, lophn, attempt]);

  const reload = () => setAttempt((value) => value + 1);

  if (rows.kind === "loading") return null;
  if (rows.kind === "failed") {
    return (
      <div className={listStyles.placeholder}>
        <ErrorState
          target={t("projects.label.target-projects")}
          onRetry={reload}
        />
      </div>
    );
  }

  const shown = rows.rows.filter((row) => showArchived || !row.archived);
  const selected = rows.rows.find((row) => row.id === current) ?? null;

  const replace = (project: ProjectRow) =>
    setRows({
      kind: "ready",
      rows: rows.rows.map((row) => row.id === project.id ? project : row),
    });

  const detail = document !== null
    ? (
      <DocumentPanel
        key={document}
        source={source}
        id={document}
        catalog={catalog}
        projects={rows.rows}
        onBack={() => {
          setDocument(null);
          reload();
        }}
        onChanged={() => setDocumentsRevision((value) => value + 1)}
      />
    )
    : selected !== null
    ? (
      <ProjectDetail
        key={`${selected.id}:${documentsRevision}`}
        source={source}
        project={selected}
        onChanged={replace}
        onLatest={reload}
        onOpenDocument={setDocument}
      />
    )
    : (
      <p className={listStyles.placeholder} data-detail="none">
        {t("projects.empty.pick")}
      </p>
    );

  return (
    <div className={listStyles.screen} data-screen-body="projects">
      <div className={listStyles.listColumn} data-list-column="">
        <Switch
          label={t("projects.label.show-archived")}
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        {shown.length === 0
          ? <p className={listStyles.hint}>{t("projects.empty.none")}</p>
          : (
            <ul className={listStyles.rows}>
              {shown.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={listStyles.row}
                    data-project={row.id}
                    aria-current={row.id === current ? "true" : undefined}
                    onClick={() => {
                      setCurrent(row.id);
                      setDocument(null);
                    }}
                  >
                    <span className={listStyles.rowHead}>
                      <span className={listStyles.rowTitle}>{row.title}</span>
                    </span>
                    <span className={listStyles.meta}>
                      <span>
                        {row.tracking
                          ? t("projects.label.tracking-on")
                          : t("projects.label.tracking-off")}
                      </span>
                      {row.archived
                        ? <span>{t("projects.label.archived")}</span>
                        : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className={listStyles.detailColumn} data-detail-column="">
        {detail}
      </div>
    </div>
  );
}
