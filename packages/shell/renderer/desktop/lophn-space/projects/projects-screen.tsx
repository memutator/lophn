import { useCallback, useEffect, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { ErrorState, StatusMark } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";
import { lophnSpaceIcons } from "../../../icons/mod.ts";

import { RegisterDialog } from "../../launcher/register-dialog.tsx";
import { ProjectDetail } from "./project-detail.tsx";
import type { ProjectItem, ProjectsSource } from "./source.ts";
import styles from "./projects.module.css";

interface ProjectsScreenProps {
  source: ProjectsSource;
}

type Rows =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly rows: readonly ProjectItem[] };

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다. 사람이 닫거나 새 위치를 고를 때까지 둔다.
const NO_TIMER = { set: () => 0, clear: () => {} };

const missingOf = (project: ProjectItem) =>
  project.folders.find((folder) => !folder.found);

// projects 화면. 왼쪽 목록 칸에서 project를 고르고 오른쪽에서 이름·목적·폴더·하위 폴더를 고친다.
export function ProjectsScreen({ source }: ProjectsScreenProps) {
  const [rows, setRows] = useState<Rows>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [saved, setSaved] = useState(false);
  const [closedToast, setClosedToast] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const load = useCallback(async () => {
    const read = await source.list();
    setRows(
      read.ok ? { kind: "ready", rows: read.value } : { kind: "failed" },
    );
  }, [source]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const reload = () => setAttempt((value) => value + 1);

  if (rows.kind === "loading") return null;
  if (rows.kind === "failed") {
    return (
      <div className={styles.placeholder}>
        <ErrorState
          target={t("projects.label.target-projects")}
          onRetry={reload}
        />
      </div>
    );
  }

  const active = rows.rows.filter((row) => !row.archived);
  const archived = rows.rows.filter((row) => row.archived);
  const selected = active.find((row) => row.id === current) ?? active[0] ??
    null;

  const replace = (project: ProjectItem) =>
    setRows({
      kind: "ready",
      rows: rows.rows.map((row) => row.id === project.id ? project : row),
    });

  const relocate = async (
    project: ProjectItem,
    folder: string,
  ): Promise<boolean> => {
    const result = await source.relocate(project, folder);
    if (!result.ok) return false;
    if (result.value !== null) replace(result.value);
    return true;
  };

  const unarchive = async (project: ProjectItem) => {
    const result = await source.setArchived(project, false);
    if (result.ok) replace(result.value);
    else reload();
  };

  const lost = active.flatMap((project) => {
    const folder = missingOf(project);
    return folder === undefined || closedToast.has(folder.path)
      ? []
      : [{ project, path: folder.path }];
  })[0];

  return (
    <div className={styles.screen} data-screen-body="projects">
      {lost === undefined
        ? null
        : (
          <div className={styles.toastSlot} data-missing-folder={lost.path}>
            <Toast
              title={t("projects.title.folder-missing")}
              body={t("projects.notice.folder-missing", { path: lost.path })}
              actions={[{
                id: "relocate",
                label: t("projects.button.choose-location"),
              }]}
              onAction={() => void relocate(lost.project, lost.path)}
              onClose={() =>
                setClosedToast(new Set([...closedToast, lost.path]))}
              timer={NO_TIMER}
            />
          </div>
        )}
      <div className={styles.listColumn} data-list-column="">
        {active.length === 0
          ? <p className={styles.muted}>{t("projects.empty.none")}</p>
          : active.map((row) => (
            <button
              key={row.id}
              type="button"
              className={styles.projectCard}
              data-project={row.id}
              aria-current={row.id === selected?.id ? "true" : undefined}
              onClick={() => {
                setCurrent(row.id);
                setSaved(false);
              }}
            >
              <span className={styles.projectName}>{row.title}</span>
              {row.purpose === ""
                ? null
                : <span className={styles.muted}>{row.purpose}</span>}
              {missingOf(row) === undefined ? null : (
                <StatusMark
                  tone="warning"
                  label={t("projects.label.folder-not-found")}
                />
              )}
            </button>
          ))}
        <button
          type="button"
          className={styles.addRound}
          aria-label={t("projects.button.register")}
          title={t("projects.button.register")}
          data-register-project=""
          onClick={() => setRegistering(true)}
        >
          <Icon icon={lophnSpaceIcons.add} pixels={iconPixels("large")} />
        </button>
        {archived.length === 0 ? null : (
          <>
            <h2 className={styles.groupTitle}>
              {t("projects.heading.archived")}
            </h2>
            {archived.map((row) => (
              <div
                key={row.id}
                className={styles.archivedRow}
                data-archived-project={row.id}
              >
                <span>{row.title}</span>
                <Button
                  size="sm"
                  icon={lophnSpaceIcons.unarchive}
                  onClick={() => void unarchive(row)}
                >
                  {t("projects.button.unarchive")}
                </Button>
              </div>
            ))}
          </>
        )}
      </div>
      <div className={styles.detailColumn} data-detail-column="">
        {selected === null
          ? (
            <p className={styles.placeholder} data-detail="none">
              {t("projects.empty.pick")}
            </p>
          )
          : (
            <ProjectDetail
              key={`${selected.id}:${selected.revision}`}
              source={source}
              project={selected}
              saved={saved}
              onChanged={(project, wasSaved) => {
                setSaved(wasSaved);
                replace(project);
              }}
              onLatest={reload}
              onRelocate={relocate}
            />
          )}
      </div>
      <RegisterDialog
        open={registering}
        source={source}
        onClose={() => setRegistering(false)}
        onRegistered={(created) => {
          setRegistering(false);
          setCurrent(created.id);
          reload();
        }}
      />
    </div>
  );
}
