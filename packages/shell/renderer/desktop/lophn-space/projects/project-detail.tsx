import { type FormEvent, useState } from "react";
import {
  Button,
  Field,
  IconButton,
  Input,
  OverviewFrame,
  Textarea,
  Tooltip,
} from "@lophn/design/components";
import { retryIcon } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { validName } from "../model.ts";
import type { LophnSource, ProjectChange, ProjectRow } from "../source.ts";
import listStyles from "./list.module.css";
import styles from "./projects.module.css";

export interface ProjectDetailProps {
  source: LophnSource;
  project: ProjectRow;
  /** 등록을 바꿨다. 목록의 행을 새 값으로 바꾼다. */
  onChanged: (project: ProjectRow) => void;
  /** 대상이 바뀌어 목록을 다시 읽는다. */
  onLatest: () => void;
}

type Change =
  | { readonly kind: "idle" }
  | { readonly kind: "saved" }
  | { readonly kind: "title-missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "taken" }
  | { readonly kind: "changed" }
  | { readonly kind: "failed" };

// 프로젝트 하나: 이름·목적 바꾸기, 보관·해제.
// 보관은 프로젝트를 목록에서 숨길 뿐 폴더의 파일을 보관하거나 지우지 않는다.
export function ProjectDetail(
  { source, project, onChanged, onLatest }: ProjectDetailProps,
) {
  const [title, setTitle] = useState(project.title);
  const [name, setName] = useState(project.name);
  const [purpose, setPurpose] = useState(project.purpose);
  const [change, setChange] = useState<Change>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  // 낡은 revision이면 대상이 바뀐 것이고, 그대로면 이름이 이미 쓰인 것이다.
  const conflictKind = async (): Promise<Change> => {
    const again = await source.projects();
    const current = again.ok
      ? again.value.find((item) => item.id === project.id)
      : undefined;
    return current?.revision === project.revision
      ? { kind: "taken" }
      : { kind: "changed" };
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const next = { title: title.trim(), name: name.trim(), purpose };
    if (next.title === "") {
      setChange({ kind: "title-missing" });
      return;
    }
    if (!validName(next.name)) {
      setChange({ kind: "invalid" });
      return;
    }
    const changed: ProjectChange = {
      ...(next.title === project.title ? {} : { title: next.title }),
      ...(next.name === project.name ? {} : { name: next.name }),
      ...(next.purpose === project.purpose ? {} : { purpose: next.purpose }),
    };
    if (Object.keys(changed).length === 0) return;
    setBusy(true);
    const result = await source.updateProject(project, changed);
    setBusy(false);
    if (!result.ok) {
      setChange(
        result.code === "conflict" ? await conflictKind() : { kind: "failed" },
      );
      return;
    }
    setChange({ kind: "saved" });
    onChanged(result.value);
  };

  const archive = async () => {
    setBusy(true);
    const result = await source.setProjectArchived(project, !project.archived);
    setBusy(false);
    if (!result.ok) {
      setChange(
        result.code === "conflict" ? { kind: "changed" } : { kind: "failed" },
      );
      return;
    }
    setChange({ kind: "idle" });
    onChanged(result.value);
  };

  const dirty = title !== project.title || name !== project.name ||
    purpose !== project.purpose;

  return (
    <OverviewFrame
      header={
        <div className={styles.head} data-project-head={project.id}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{project.title}</h1>
          </div>
          <p className={styles.meta}>
            <span className={styles.rule}>{project.name}</span>
            {project.archived
              ? <span>{t("projects.label.archived")}</span>
              : null}
          </p>
        </div>
      }
    >
      <div className={styles.body}>
        {change.kind === "changed"
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
        {project.archived
          ? (
            <p className={listStyles.notice} data-project-archived="">
              {t("projects.notice.archived")}
            </p>
          )
          : null}
        <form
          className={styles.form}
          onSubmit={(event) => void save(event)}
          data-project-form=""
        >
          <Field
            label={t("projects.label.title")}
            error={change.kind === "title-missing"
              ? t("projects.error.title-missing")
              : undefined}
          >
            <Input
              data-project-title=""
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field
            label={t("projects.label.name")}
            help={t("projects.label.name-help")}
            error={change.kind === "invalid"
              ? t("projects.error.name-invalid")
              : change.kind === "taken"
              ? t("projects.error.name-taken")
              : undefined}
          >
            <Input
              data-project-name=""
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("projects.label.purpose")}>
            <Textarea
              data-project-purpose=""
              rows={3}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              data-project-save=""
              disabled={busy || !dirty}
            >
              {t("projects.button.save")}
            </Button>
            {change.kind === "saved"
              ? (
                <span className={listStyles.hint} data-project-saved="">
                  {t("projects.notice.saved")}
                </span>
              )
              : null}
          </div>
          {change.kind === "failed"
            ? (
              <p className={listStyles.error} data-project-failed="">
                {t("projects.error.project-change-failed")}
              </p>
            )
            : null}
        </form>
        <section className={listStyles.section} data-project-archive="">
          <p className={listStyles.hint}>
            {t("projects.notice.archive-keeps")}
          </p>
          <div className={styles.actions}>
            <Button
              data-archive-project={project.archived ? "unarchive" : "archive"}
              disabled={busy}
              onClick={() => void archive()}
            >
              {project.archived
                ? t("projects.button.unarchive")
                : t("projects.button.archive")}
            </Button>
          </div>
        </section>
      </div>
    </OverviewFrame>
  );
}
