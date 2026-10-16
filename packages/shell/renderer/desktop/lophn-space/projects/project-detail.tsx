import { type FormEvent, useState } from "react";
import {
  Button,
  Field,
  IconButton,
  Input,
  StatusMark,
  Textarea,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";
import { lophnSpaceIcons, retryIcon } from "../../../icons/mod.ts";

import {
  addFolder,
  addSubfolder,
  changeFolder,
  changeOf,
  changeSubfolder,
  type Draft,
  draftOf,
  removeFolder,
  usableName,
} from "./model.ts";
import { SubfolderPicker } from "./subfolder-picker.tsx";
import type { ProjectItem, ProjectsSource } from "./source.ts";
import styles from "./projects.module.css";

export interface ProjectDetailProps {
  source: ProjectsSource;
  project: ProjectItem;
  /** 등록을 바꿨다. 목록의 행을 새 값으로 바꾼다. */
  onChanged: (project: ProjectItem, saved: boolean) => void;
  /** 대상이 바뀌어 목록을 다시 읽는다. */
  onLatest: () => void;
  /** 사라진 폴더의 새 위치를 고른다. 화면 위쪽 toast와 같은 길이다. */
  onRelocate: (project: ProjectItem, folder: string) => Promise<boolean>;
  /** 저장했다는 안내를 보인다. */
  saved: boolean;
}

type Problem = "name-missing" | "changed" | "failed" | "picker-failed";

// 프로젝트 하나: 이름·목적·폴더·폴더 설명·하위 폴더를 고치고 저장한다. 보관은 목록에서만 숨긴다.
// 고침은 [Save changes]를 누를 때까지 초안에만 있다.
export function ProjectDetail(
  { source, project, onChanged, onLatest, onRelocate, saved }:
    ProjectDetailProps,
) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(project));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

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
    onChanged(result.value, true);
  };

  const archive = async () => {
    setBusy(true);
    setProblem(null);
    const result = await source.setArchived(project, true);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code === "conflict" ? "changed" : "failed");
      return;
    }
    onChanged(result.value, false);
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
    if (!await onRelocate(project, folder)) setProblem("failed");
  };

  const addingFolder = draft.folders.find((folder) => folder.path === adding);

  return (
    <section
      className={styles.detail}
      aria-label={project.title}
      data-project-detail={project.id}
    >
      <h1 className={styles.detailTitle}>{project.title}</h1>
      {problem === "changed"
        ? (
          <p className={styles.notice} data-changed="">
            <span>{t("projects.error.changed")}</span>
            <Tooltip content={t("projects.button.show-latest")}>
              <IconButton
                icon={retryIcon}
                label={t("projects.button.show-latest")}
                size="sm"
                data-show-latest=""
                onClick={onLatest}
              />
            </Tooltip>
          </p>
        )
        : null}
      <form
        className={styles.form}
        onSubmit={(event) => void save(event)}
        data-project-form=""
      >
        <Field
          label={t("projects.label.name")}
          error={problem === "name-missing"
            ? t("projects.error.name-missing")
            : undefined}
        >
          <Input
            data-project-title=""
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.currentTarget.value })}
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
              setDraft({ ...draft, purpose: event.currentTarget.value })}
          />
        </Field>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("projects.heading.folders")}
            </h2>
            <Button
              size="sm"
              icon={lophnSpaceIcons.add}
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
                          variant="primary"
                          data-relocate=""
                          onClick={() => void relocate(folder.path)}
                        >
                          {t("projects.button.choose-location")}
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-remove-folder=""
                      disabled={draft.folders.length === 1}
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
                        changeFolder(
                          draft,
                          folder.path,
                          (item) => ({ ...item, description }),
                        ),
                      );
                    }}
                  />
                </Field>
                <div className={styles.subfolders}>
                  <div className={styles.subHead}>
                    <span className={styles.subTitle}>
                      {t("projects.heading.subfolders")}
                    </span>
                    <Button
                      size="sm"
                      icon={lophnSpaceIcons.add}
                      disabled={!folder.found}
                      data-add-subfolder=""
                      onClick={() => setAdding(folder.path)}
                    >
                      {t("projects.button.add-subfolder")}
                    </Button>
                  </div>
                  {folder.subfolders.length === 0
                    ? (
                      <p className={styles.muted}>
                        {folder.found
                          ? t("projects.empty.no-subfolders")
                          : t("projects.notice.relocate-first")}
                      </p>
                    )
                    : (
                      <ul className={styles.subfolderList}>
                        {folder.subfolders.map((sub) => {
                          const original = project.folders
                            .find((item) => item.path === folder.path)
                            ?.subfolders.find((item) => item.path === sub.path);
                          return sub.removed
                            ? (
                              <li
                                key={sub.path}
                                className={styles.subfolderRemoved}
                                data-subfolder-removed={sub.path}
                              >
                                <span>
                                  {t("projects.notice.subfolder-removed", {
                                    path: sub.path,
                                  })}
                                </span>
                                <Button
                                  size="sm"
                                  data-undo-subfolder=""
                                  onClick={() =>
                                    setDraft(
                                      changeSubfolder(
                                        draft,
                                        folder.path,
                                        sub.path,
                                        (item) => ({
                                          ...item,
                                          removed: false,
                                        }),
                                      ),
                                    )}
                                >
                                  {t("projects.button.undo")}
                                </Button>
                              </li>
                            )
                            : (
                              <li
                                key={sub.path}
                                className={styles.subfolder}
                                data-subfolder={sub.path}
                              >
                                <div className={styles.folderHead}>
                                  <span className={styles.path}>
                                    {sub.path}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    data-remove-subfolder=""
                                    onClick={() =>
                                      setDraft(
                                        changeSubfolder(
                                          draft,
                                          folder.path,
                                          sub.path,
                                          (item) => ({
                                            ...item,
                                            removed: true,
                                          }),
                                        ),
                                      )}
                                  >
                                    {t("projects.button.remove")}
                                  </Button>
                                </div>
                                <Field
                                  label={t(
                                    "projects.label.subfolder-description",
                                  )}
                                  help={original !== undefined &&
                                      original.description !== sub.description
                                    ? t("projects.help.subfolder-edited")
                                    : undefined}
                                >
                                  <Input
                                    size="sm"
                                    value={sub.description}
                                    data-subfolder-description=""
                                    onChange={(event) => {
                                      const description =
                                        event.currentTarget.value;
                                      setDraft(
                                        changeSubfolder(
                                          draft,
                                          folder.path,
                                          sub.path,
                                          (item) => ({ ...item, description }),
                                        ),
                                      );
                                    }}
                                  />
                                </Field>
                              </li>
                            );
                        })}
                      </ul>
                    )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.actions}>
          {saved && change === null
            ? (
              <span className={styles.muted} data-project-saved="">
                {t("projects.notice.saved")}
              </span>
            )
            : null}
          <Button
            type="submit"
            variant="primary"
            data-project-save=""
            disabled={busy || change === null}
          >
            {t("projects.button.save")}
          </Button>
        </div>
        {problem === "failed"
          ? (
            <p className={styles.error} role="alert" data-project-failed="">
              {t("projects.error.project-change-failed")}
            </p>
          )
          : null}
        {problem === "picker-failed"
          ? (
            <p className={styles.error} role="alert">
              {t("launcher.error.picker-failed")}
            </p>
          )
          : null}
      </form>
      <div className={styles.dangerZone} data-project-archive="">
        <p className={styles.muted}>{t("projects.notice.archive-keeps")}</p>
        <Button
          variant="danger"
          icon={lophnSpaceIcons.archive}
          data-archive-project="archive"
          disabled={busy}
          onClick={() => void archive()}
        >
          {t("projects.button.archive")}
        </Button>
      </div>
      <SubfolderPicker
        open={adding !== null}
        root={adding ?? ""}
        added={addingFolder?.subfolders
          .filter((sub) => !sub.removed)
          .map((sub) => sub.path) ?? []}
        source={source}
        onClose={() => setAdding(null)}
        onAdd={(subfolder) => {
          if (adding !== null) setDraft(addSubfolder(draft, adding, subfolder));
          setAdding(null);
        }}
      />
    </section>
  );
}
