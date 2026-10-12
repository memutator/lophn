import { type FormEvent, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  Field,
  IconButton,
  Input,
  lophnSpaceIcons,
  OverviewFrame,
  retryIcon,
  Select,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { placeOf, placeTitle, placeValue } from "../model.ts";
import type { Catalog, PlaceRef } from "../source.ts";
import {
  defaultFileName,
  joinPath,
  nameFromTitle,
  placeableProjects,
  validFileName,
  validName,
} from "./model.ts";
import type {
  DocumentDetail,
  OrganizeSource,
  PlaceOutcome,
  ProjectRow,
  UnlinkOutcome,
} from "./source.ts";
import { PlaceResult, UnlinkResult } from "./steps.tsx";
import listStyles from "../documents/documents.module.css";
import headStyles from "../series/series.module.css";
import styles from "./organize.module.css";

export interface DocumentPanelProps {
  source: OrganizeSource;
  id: string;
  catalog: Catalog;
  projects: readonly ProjectRow[];
  onBack: () => void;
  /** 이름·자리·파일이 바뀌었다. 자리 목록을 다시 읽게 한다. */
  onChanged: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly detail: DocumentDetail };

/** 이름·자리 바꾸기의 결과. 묻지 않고 하고 결과를 보인다. */
type Change =
  | { readonly kind: "idle" }
  | { readonly kind: "renamed"; readonly name: string }
  | { readonly kind: "moved"; readonly place: PlaceRef | null }
  | { readonly kind: "invalid" }
  | { readonly kind: "taken" }
  | { readonly kind: "changed" }
  | { readonly kind: "failed" };

type Removal =
  | { readonly kind: "idle" }
  | { readonly kind: "review" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "done"; readonly outcome: UnlinkOutcome };

const NO_PLACE = "none";

// 문서 하나의 정리: 링크 이름 바꾸기, 자리 옮기기, 파일로 두기와 빼기(flow organize-documents).
// 이름·자리는 되돌릴 수 있어 묻지 않고 바꾼다. 원본 파일은 자리를 옮겨도 그대로다. 파일을
// 지우는 빼기만 보호 창의 사람 결정으로 보낸다.
export function DocumentPanel(
  { source, id, catalog, projects, onBack, onChanged }: DocumentPanelProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [change, setChange] = useState<Change>({ kind: "idle" });
  const [name, setName] = useState("");
  const [target, setTarget] = useState(NO_PLACE);
  const [placing, setPlacing] = useState<
    { project: string; folder: string; file: string }
  >({ project: "", folder: "", file: "" });
  const [placed, setPlaced] = useState<PlaceOutcome | null>(null);
  const [removal, setRemoval] = useState<Removal>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const placeable = placeableProjects(projects);

  useEffect(() => {
    let live = true;
    void source.document(id).then((read) => {
      if (!live) return;
      if (!read.ok) {
        setLoaded({ kind: "failed" });
        return;
      }
      const detail = read.value;
      setLoaded({ kind: "ready", detail });
      setName(detail.name ?? nameFromTitle(detail.title));
      setTarget(detail.place === null ? NO_PLACE : placeValue(detail.place));
      const choices = placeableProjects(projects);
      const own = choices.find((project) =>
        detail.place?.kind === "project" && project.id === detail.place.id
      ) ?? choices[0];
      setPlacing({
        project: own?.id ?? "",
        folder: own?.folders[0] ?? "",
        file: defaultFileName(detail),
      });
    });
    return () => {
      live = false;
    };
  }, [source, id, attempt, projects]);

  if (loaded.kind === "loading") return null;
  if (loaded.kind === "failed") {
    return (
      <div className={headStyles.state}>
        <ErrorState
          target={t("projects.label.target-documents")}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  }
  const detail = loaded.detail;
  const reload = () => setAttempt((value) => value + 1);

  // 낡은 revision이면 대상이 바뀐 것이고, 그대로면 이름이 이미 쓰인 것이다(addressing#R2).
  const conflictKind = async (): Promise<Change> => {
    const again = await source.document(detail.id);
    return again.ok && again.value.revision === detail.revision
      ? { kind: "taken" }
      : { kind: "changed" };
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!validName(next)) {
      setChange({ kind: "invalid" });
      return;
    }
    if (next === detail.name) return;
    setBusy(true);
    const result = await source.renameDocument(detail, next);
    setBusy(false);
    if (!result.ok) {
      setChange(
        result.code === "conflict" ? await conflictKind() : { kind: "failed" },
      );
      return;
    }
    setLoaded({ kind: "ready", detail: result.value });
    setChange({ kind: "renamed", name: next });
    onChanged();
  };

  const move = async (event: FormEvent) => {
    event.preventDefault();
    const place = target === NO_PLACE ? null : placeOf(target);
    const linkName = place === null ? null : name.trim();
    if (linkName !== null && !validName(linkName)) {
      setChange({ kind: "invalid" });
      return;
    }
    setBusy(true);
    const result = await source.moveDocument(detail, place, linkName);
    setBusy(false);
    if (!result.ok) {
      setChange(
        result.code === "conflict" ? await conflictKind() : { kind: "failed" },
      );
      return;
    }
    setLoaded({ kind: "ready", detail: result.value });
    setChange({ kind: "moved", place });
    onChanged();
  };

  const place = async (event: FormEvent) => {
    event.preventDefault();
    if (placing.project === "" || !validFileName(placing.file)) return;
    setBusy(true);
    const result = await source.placeFile(
      detail,
      placing.project,
      joinPath(placing.folder, placing.file),
    );
    setBusy(false);
    setPlaced(
      result.ok ? result.value : { file: "failed", path: null, steps: null },
    );
    if (result.ok && result.value.file === "written") {
      onChanged();
      reload();
    }
  };

  const remove = async () => {
    setBusy(true);
    const result = await source.removeFile(detail);
    setBusy(false);
    if (!result.ok) {
      setRemoval({ kind: "unavailable" });
      return;
    }
    if (result.value.kind === "review") {
      setRemoval({ kind: "review" });
      return;
    }
    setRemoval({ kind: "done", outcome: result.value.outcome });
    onChanged();
    reload();
  };

  const placeName = (ref: PlaceRef | null) =>
    ref === null ? null : placeTitle(catalog, ref) ?? ref.id;
  const placeOptions = [
    { value: NO_PLACE, label: t("projects.label.no-place") },
    ...catalog.projects.map((item) => ({
      value: placeValue({ kind: "project", id: item.id }),
      label: item.title,
    })),
    ...catalog.apps.map((item) => ({
      value: placeValue({ kind: "app", id: item.id }),
      label: item.title,
    })),
  ];
  const chosenProject = placeable.find((item) => item.id === placing.project);
  const backLabel = t("projects.button.back-to-project");

  return (
    <OverviewFrame
      header={
        <div className={headStyles.head} data-organize-head={detail.id}>
          <div className={headStyles.titleRow}>
            <h1 className={headStyles.title}>{detail.title}</h1>
            <Tooltip content={backLabel}>
              <IconButton
                icon={lophnSpaceIcons.back}
                label={backLabel}
                data-organize-back=""
                onClick={onBack}
              />
            </Tooltip>
          </div>
          <p className={headStyles.meta}>
            <span>
              {placeName(detail.place) ?? t("projects.label.no-place")}
            </span>
            {detail.archived
              ? <span>{t("projects.label.archived")}</span>
              : null}
          </p>
        </div>
      }
    >
      <div className={styles.panel} data-organize={detail.id}>
        <ChangeNote
          change={change}
          catalog={catalog}
          linked={detail.file !== null}
          onLatest={reload}
        />
        <section className={listStyles.section}>
          <h2 className={listStyles.sectionLabel}>
            {t("projects.heading.document")}
          </h2>
          <form
            className={styles.form}
            onSubmit={(event) => void rename(event)}
            data-rename-form=""
          >
            <div className={styles.grow}>
              <Field
                label={t("projects.label.document-name")}
                error={change.kind === "invalid"
                  ? t("projects.error.name-invalid")
                  : change.kind === "taken"
                  ? t("projects.error.document-name-taken")
                  : undefined}
              >
                <Input
                  data-document-name=""
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </div>
            <Button
              type="submit"
              data-rename=""
              disabled={busy || detail.place === null}
            >
              {t("projects.button.rename")}
            </Button>
          </form>
          <form
            className={styles.form}
            onSubmit={(event) => void move(event)}
            data-move-form=""
          >
            <div className={styles.grow}>
              <Field label={t("projects.label.move-to")}>
                <Select
                  options={placeOptions}
                  value={target}
                  onValueChange={setTarget}
                />
              </Field>
            </div>
            <Button
              type="submit"
              data-move=""
              disabled={busy ||
                target ===
                  (detail.place === null ? NO_PLACE : placeValue(detail.place))}
            >
              {t("projects.button.move")}
            </Button>
          </form>
          {change.kind === "failed"
            ? (
              <p className={listStyles.error} data-change-failed="">
                {t("projects.error.document-change-failed")}
              </p>
            )
            : null}
        </section>
        <section className={listStyles.section} data-file-section="">
          <h2 className={listStyles.sectionLabel}>
            {t("projects.heading.file")}
          </h2>
          {detail.file !== null
            ? (
              <div className={styles.stack} data-file-linked="">
                <p className={listStyles.hint}>
                  {t("projects.label.file-linked")}
                </p>
                <p className={styles.path} data-file-path="">
                  {detail.file.path}
                </p>
                <p className={listStyles.hint}>
                  {t("projects.notice.remove-help")}
                </p>
                <div className={styles.actions}>
                  <Button
                    variant="danger"
                    data-remove-file=""
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {t("projects.button.remove-file")}
                  </Button>
                </div>
              </div>
            )
            : (
              <div className={styles.stack} data-file-none="">
                <p className={listStyles.hint}>
                  {t("projects.notice.file-none")}
                </p>
                {detail.singleFile === null
                  ? (
                    <p className={listStyles.notice} data-place-many="">
                      {t("projects.notice.place-many-files")}
                    </p>
                  )
                  : placeable.length === 0
                  ? (
                    <p className={listStyles.notice} data-place-none="">
                      {t("projects.notice.place-no-project")}
                    </p>
                  )
                  : (
                    <form
                      className={styles.stack}
                      onSubmit={(event) => void place(event)}
                      data-place-form=""
                    >
                      <p className={listStyles.hint}>
                        {t("projects.notice.place-help")}
                      </p>
                      {placeable.length > 1
                        ? (
                          <Field label={t("projects.label.place-project")}>
                            <Select
                              options={placeable.map((item) => ({
                                value: item.id,
                                label: item.title,
                              }))}
                              value={placing.project}
                              onValueChange={(project) =>
                                setPlacing({
                                  ...placing,
                                  project,
                                  folder: placeable.find((item) =>
                                    item.id === project
                                  )?.folders[0] ?? "",
                                })}
                            />
                          </Field>
                        )
                        : null}
                      {chosenProject && chosenProject.folders.length > 1
                        ? (
                          <Field label={t("projects.label.file-folder")}>
                            <Select
                              options={chosenProject.folders.map((folder) => ({
                                value: folder,
                                label: folder,
                              }))}
                              value={placing.folder}
                              onValueChange={(folder) =>
                                setPlacing({ ...placing, folder })}
                            />
                          </Field>
                        )
                        : null}
                      <div className={styles.form}>
                        <div className={styles.grow}>
                          <Field label={t("projects.label.file-name")}>
                            <Input
                              data-file-name=""
                              value={placing.file}
                              onChange={(event) =>
                                setPlacing({
                                  ...placing,
                                  file: event.target.value,
                                })}
                            />
                          </Field>
                        </div>
                        <Button
                          type="submit"
                          variant="primary"
                          data-place=""
                          disabled={busy || !validFileName(placing.file)}
                        >
                          {t("projects.button.place")}
                        </Button>
                      </div>
                      <p className={styles.path} data-place-target="">
                        {joinPath(placing.folder, placing.file)}
                      </p>
                    </form>
                  )}
              </div>
            )}
          {placed === null ? null : <PlaceResult outcome={placed} />}
          {removal.kind === "review"
            ? (
              <p className={listStyles.hint} data-review-opened="">
                {t("projects.notice.review-opened")}
              </p>
            )
            : removal.kind === "unavailable"
            ? (
              <p className={listStyles.notice} data-review-unavailable="">
                {t("projects.error.review-unavailable")}
              </p>
            )
            : removal.kind === "done"
            ? <UnlinkResult outcome={removal.outcome} />
            : null}
        </section>
      </div>
    </OverviewFrame>
  );
}

// 이름·자리 바꾸기의 결과. 대상이 바뀌었으면 최신 내용으로 가는 길만 남긴다.
function ChangeNote(
  { change, catalog, linked, onLatest }: {
    change: Change;
    catalog: Catalog;
    linked: boolean;
    onLatest: () => void;
  },
) {
  if (change.kind === "changed") {
    return (
      <p className={headStyles.notice} data-changed="">
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
    );
  }
  if (change.kind === "renamed") {
    return (
      <div className={styles.result} data-renamed={change.name}>
        <p className={listStyles.hint}>
          {t("projects.notice.renamed", { name: change.name })}
        </p>
        {!linked ? null : (
          <p className={listStyles.hint}>
            {t("projects.notice.file-stays")}
          </p>
        )}
      </div>
    );
  }
  if (change.kind === "moved") {
    const where = change.place === null
      ? null
      : placeTitle(catalog, change.place) ?? change.place.id;
    return (
      <div className={styles.result} data-moved={where ?? ""}>
        <p className={listStyles.hint}>
          {where === null
            ? t("projects.notice.moved-out")
            : t("projects.notice.moved", { place: where })}
        </p>
        {!linked ? null : (
          <p className={listStyles.hint}>
            {t("projects.notice.file-stays")}
          </p>
        )}
      </div>
    );
  }
  return null;
}
