import { useEffect, useState } from "react";
import { ErrorState, Switch } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { LophnSource, ProjectRow } from "../source.ts";
import { ProjectDetail } from "./project-detail.tsx";
import listStyles from "./list.module.css";

export interface ProjectsScreenProps {
  source: LophnSource;
}

type Rows =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly rows: readonly ProjectRow[] };

// projects 화면. 왼쪽 목록 칸에서 프로젝트를 고르고 오른쪽에서 이름·목적·보관을 바꾼다.
export function ProjectsScreen({ source }: ProjectsScreenProps) {
  const [rows, setRows] = useState<Rows>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void source.projects().then((read) => {
      if (!live) return;
      setRows(
        read.ok ? { kind: "ready", rows: read.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, attempt]);

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

  const detail = selected !== null
    ? (
      <ProjectDetail
        key={selected.id}
        source={source}
        project={selected}
        onChanged={replace}
        onLatest={reload}
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
                    onClick={() => setCurrent(row.id)}
                  >
                    <span className={listStyles.rowHead}>
                      <span className={listStyles.rowTitle}>{row.title}</span>
                    </span>
                    <span className={listStyles.meta}>
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
