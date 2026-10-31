import { type FormEvent, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Field, Input, Textarea } from "@lophn/ui/input";
import { StatusMark } from "@lophn/ui/feedback";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import { actionIcons, launcherIcons } from "../../../icons/mod.ts";

import {
  addFolder,
  changeFolder,
  changeOf,
  type Draft,
  draftOf,
  removeFolder,
  usableName,
} from "./model.ts";
import type { ProjectItem, ProjectsSource } from "./source.ts";
import styles from "./project-detail.module.css";

interface ProjectFormProps {
  source: ProjectsSource;
  project: ProjectItem;
  /** 등록을 바꿨다. 목록의 카드를 새 값으로 바꾼다. */
  onChanged: (project: ProjectItem) => void;
  /** 대상이 바뀌어 목록을 다시 읽는다. */
  onLatest: () => void;
  /** 사라진 폴더의 새 위치를 고른다. 카드의 [Choose new location]과 같은 길이다. */
  onRelocate: (project: ProjectItem, folder: string) => Promise<boolean>;
  /** 저장했다는 안내를 보인다. */
  saved: boolean;
}

type Problem = "name-missing" | "changed" | "failed" | "picker-failed";

// 프로젝트 하나: 이름·목적·폴더·폴더 설명을 고치고 저장한다.
// 고침은 [Save changes]를 누를 때까지 초안에만 있다.
function ProjectForm({
  source,
  project,
  onChanged,
  onLatest,
  onRelocate,
  saved,
}: ProjectFormProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(project));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  const change = changeOf(project, draft);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!usableName(draft.title)) {
      setProblem("name-missing");
      return;
    }
    if (change === null) return;
    setBusy(true);
    setProblem(null);
    const result = await source.save(project, change);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code === "conflict" ? "changed" : "failed");
      return;
    }
    onChanged(result.value);
  };

  const pickFolder = async () => {
    setProblem(null);
    const chosen = await source.pickFolder();
    if (!chosen.ok) {
      setProblem("picker-failed");
      return;
    }
    if (chosen.path !== null) setDraft(addFolder(draft, chosen.path));
  };

  const relocate = async (folder: string) => {
    setProblem(null);
    if (!(await onRelocate(project, folder))) setProblem("failed");
  };

  return (
    <section
      className={styles.detail}
      aria-label={project.title}
      data-project-detail={project.id}
    >
      {problem === "changed" ? (
        <p className={styles.notice} data-changed="">
          <span>{t("projects.error.changed")}</span>
          <Tooltip content={t("projects.button.show-latest")}>
            <IconButton
              icon={actionIcons.refresh}
              label={t("projects.button.show-latest")}
              size="sm"
              data-show-latest=""
              onClick={onLatest}
            />
          </Tooltip>
        </p>
      ) : null}
      <form
        className={styles.form}
        onSubmit={(event) => void save(event)}
        data-project-form=""
      >
        <Field
          label={t("projects.label.name")}
          error={
            problem === "name-missing"
              ? t("projects.error.name-missing")
              : undefined
          }
        >
          <Input
            data-project-title=""
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.currentTarget.value })
            }
          />
        </Field>
        <Field
          label={t("projects.label.purpose")}
          help={t("launcher.field.purpose-help")}
        >
          <Textarea
            data-project-purpose=""
            rows={2}
            value={draft.purpose}
            onChange={(event) =>
              setDraft({ ...draft, purpose: event.currentTarget.value })
            }
          />
        </Field>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("projects.heading.folders")}
            </h2>
            <Button
              size="sm"
              icon={actionIcons.add}
              data-add-folder=""
              onClick={() => void pickFolder()}
            >
              {t("projects.button.add-folder")}
            </Button>
          </div>
          <ul className={styles.folderList}>
            {draft.folders.map((folder) => (
              <li
                key={folder.path}
                className={styles.folder}
                data-folder={folder.path}
              >
                <div className={styles.folderHead}>
                  <span
                    className={`${styles.path} ${
                      folder.found ? "" : styles.pathMissing
                    }`}
                  >
                    {folder.path}
                  </span>
                  <span className={styles.folderActions}>
                    {folder.found ? null : (
                      <>
                        <StatusMark
                          tone="warning"
                          label={t("projects.label.not-found")}
                        />
                        <Button
                          size="sm"
                          icon={launcherIcons.chooseFolder}
                          data-relocate=""
                          onClick={() => void relocate(folder.path)}
                        >
                          {t("launcher.button.choose-location")}
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={actionIcons.remove}
                      data-remove-folder=""
                      onClick={() => setDraft(removeFolder(draft, folder.path))}
                    >
                      {t("projects.button.remove")}
                    </Button>
                  </span>
                </div>
                <Field label={t("projects.label.folder-description")}>
                  <Input
                    size="sm"
                    value={folder.description}
                    data-folder-description=""
                    onChange={(event) => {
                      const description = event.currentTarget.value;
                      setDraft(
                        changeFolder(draft, folder.path, (item) => ({
                          ...item,
                          description,
                        })),
                      );
                    }}
                  />
                </Field>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.actions}>
          {saved && change === null ? (
            <span className={styles.muted} data-project-saved="">
              {t("projects.notice.saved")}
            </span>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            icon={actionIcons.save}
            data-project-save=""
            disabled={busy || change === null}
          >
            {t("projects.button.save")}
          </Button>
        </div>
        {problem === "failed" ? (
          <p className={styles.error} role="alert" data-project-failed="">
            {t("projects.error.project-change-failed")}
          </p>
        ) : null}
        {problem === "picker-failed" ? (
          <p className={styles.error} role="alert">
            {t("launcher.error.picker-failed")}
          </p>
        ) : null}
      </form>
    </section>
  );
}

interface ProjectDetailDialogProps {
  source: ProjectsSource;
  project: ProjectItem;
  /** 등록을 바꿨다. 목록의 카드를 새 값으로 바꾼다. */
  onChanged: (project: ProjectItem) => void;
  onLatest: () => void;
  onRelocate: (project: ProjectItem, folder: string) => Promise<boolean>;
  onClose: () => void;
}

// 카드의 [Details]가 여는 dialog. 열려 있는 동안만 그려서 열 때마다 처음 초안에서 시작한다.
export function ProjectDetailDialog({
  source,
  project,
  onChanged,
  onLatest,
  onRelocate,
  onClose,
}: ProjectDetailDialogProps) {
  const [saved, setSaved] = useState(false);
  return (
    <Dialog
      open
      width="wide"
      title={project.title}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ProjectForm
        key={`${project.id}:${project.revision}`}
        source={source}
        project={project}
        saved={saved}
        onChanged={(next) => {
          setSaved(true);
          onChanged(next);
        }}
        onLatest={onLatest}
        onRelocate={onRelocate}
      />
    </Dialog>
  );
}
