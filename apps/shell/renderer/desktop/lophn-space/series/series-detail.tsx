import { type FormEvent, useEffect, useState } from "react";
import {
  Button,
  editorIcons,
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

import { documentNameForKey, isLatest, placeTitle } from "../model.ts";
import type {
  Catalog,
  LophnSource,
  NextSuggestion,
  PlaceDocument,
  Series,
  SeriesDetail,
  SeriesMember,
} from "../source.ts";
import { formatLabel } from "../documents/notices.tsx";
import listStyles from "../documents/documents.module.css";
import styles from "./series.module.css";

export interface SeriesDetailProps {
  source: LophnSource;
  id: string;
  catalog: Catalog;
  /** 멤버를 순서대로 읽는다. */
  onRead: (members: readonly SeriesMember[], index: number) => void;
  /** 가족이 바뀌었다(보관·멤버 추가). 목록을 다시 읽게 한다. */
  onChanged: () => void;
  /**
   * draft가 선 가족의 새 멤버를 쓴다. 편집 통로가 있는 창에서만 준다. 편집기는 Markdown 글을
   * 쓰므로 document format 가족만 쓴다.
   */
  onWrite?: (series: Series) => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
    readonly kind: "ready";
    readonly detail: SeriesDetail;
    readonly next: NextSuggestion | null;
    readonly candidates: readonly PlaceDocument[];
  };

type Change =
  | { readonly kind: "idle" }
  | { readonly kind: "changed" }
  | { readonly kind: "key-taken" }
  | { readonly kind: "key-unnamed" }
  | { readonly kind: "failed" };

// 한 가족: 순서대로 key·제목·판, 다음 key 제안과 근거, 멤버 추가, 보관·해제.
// 제안은 읽기만 한다. 문서·key를 만들거나 예약하지 않는다(documents/series#R6).
export function SeriesDetailView(
  { source, id, catalog, onRead, onChanged, onWrite }: SeriesDetailProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [change, setChange] = useState<Change>({ kind: "idle" });
  const [key, setKey] = useState("");
  const [document, setDocument] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void source.series(id).then(async (detail) => {
      if (!live) return;
      if (!detail.ok) {
        setLoaded({ kind: "failed" });
        return;
      }
      const series = detail.value.series;
      const [next, documents] = await Promise.all([
        source.nextKey(id),
        source.placeDocuments(series.place),
      ]);
      if (!live) return;
      const members = new Set(
        detail.value.members.map((item) => item.document),
      );
      const candidates = documents.ok
        ? documents.value.filter((item) =>
          item.format === series.format && !members.has(item.id)
        )
        : [];
      const suggestion = next.ok ? next.value : null;
      setLoaded({
        kind: "ready",
        detail: detail.value,
        next: suggestion,
        candidates,
      });
      setKey(suggestion !== null && !suggestion.taken ? suggestion.key : "");
      setDocument(undefined);
    });
    return () => {
      live = false;
    };
  }, [source, id, attempt]);

  if (loaded.kind === "loading") return null;
  if (loaded.kind === "failed") {
    return (
      <div className={styles.state}>
        <ErrorState
          target={t("documents.label.target-series")}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  }

  const { detail, next, candidates } = loaded;
  const { series, members } = detail;
  const reload = () => setAttempt((value) => value + 1);

  const archive = async () => {
    const result = await source.setArchived(series, !series.archived);
    if (!result.ok) {
      setChange(
        result.code === "conflict" ? { kind: "changed" } : { kind: "failed" },
      );
      return;
    }
    setChange({ kind: "idle" });
    onChanged();
    reload();
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (document === undefined || key.trim() === "") return;
    const result = await source.addMember(series, document, key.trim());
    if (!result.ok) {
      setChange(
        result.code === "conflict"
          ? members.some((item) => item.key === key.trim())
            ? { kind: "key-taken" }
            : { kind: "changed" }
          : { kind: "failed" },
      );
      return;
    }
    setChange({ kind: "idle" });
    onChanged();
    reload();
  };

  // 이 key로 새 멤버를 쓰기 시작한다. 가족 draft(예정 문서·key)만 서고 문서는 아직 없다.
  const write = async () => {
    const chosen = key.trim();
    if (chosen === "" || !onWrite) return;
    if (documentNameForKey(chosen) === null) {
      setChange({ kind: "key-unnamed" });
      return;
    }
    const result = await source.startDraft(series, chosen);
    if (!result.ok) {
      setChange(
        result.code === "conflict"
          ? members.some((item) => item.key === chosen) ||
              next?.taken === true && next.key === chosen
            ? { kind: "key-taken" }
            : { kind: "changed" }
          : { kind: "failed" },
      );
      return;
    }
    setChange({ kind: "idle" });
    onChanged();
    onWrite(result.value);
  };
  const writable = onWrite !== undefined && series.format === "document";

  const archiveLabel = series.archived
    ? t("documents.button.unarchive-series")
    : t("documents.button.archive-series");
  const addLabel = t("documents.button.add-member");
  const writeLabel = t("documents.button.write-member");

  return (
    <OverviewFrame
      header={
        <div className={styles.head} data-series-head={series.id}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{series.title}</h1>
            <Tooltip content={archiveLabel}>
              <IconButton
                icon={series.archived
                  ? lophnSpaceIcons.unarchive
                  : lophnSpaceIcons.archive}
                label={archiveLabel}
                data-archive-series={series.archived ? "unarchive" : "archive"}
                onClick={() => void archive()}
              />
            </Tooltip>
          </div>
          <p className={styles.meta}>
            <span>{placeTitle(catalog, series.place) ?? ""}</span>
            <span>{formatLabel(series.format)}</span>
            <span className={styles.rule}>
              {t("documents.label.series-rule", { rule: series.nextRule })}
            </span>
          </p>
        </div>
      }
    >
      <div className={styles.body}>
        {change.kind === "changed"
          ? (
            <p className={styles.notice} data-changed="">
              <span>{t("documents.error.changed")}</span>
              <Tooltip content={t("documents.button.open-latest-series")}>
                <IconButton
                  icon={retryIcon}
                  label={t("documents.button.open-latest-series")}
                  size="sm"
                  data-reload-series=""
                  onClick={reload}
                />
              </Tooltip>
            </p>
          )
          : null}
        {series.archived
          ? (
            <p className={listStyles.notice} data-series-archived="">
              {t("documents.notice.series-archived")}
            </p>
          )
          : null}
        <section className={listStyles.section} data-members="">
          <h2 className={listStyles.sectionLabel}>
            {t("documents.heading.members")}
          </h2>
          {members.length === 0
            ? (
              <p className={listStyles.hint}>
                {t("documents.empty.no-members")}
              </p>
            )
            : (
              <ol className={listStyles.rows}>
                {members.map((member, index) => (
                  <li key={member.document}>
                    <button
                      type="button"
                      className={listStyles.row}
                      data-member={member.key}
                      onClick={() => onRead(members, index)}
                    >
                      <span className={listStyles.rowHead}>
                        <span className={listStyles.key}>{member.key}</span>
                        <span className={listStyles.rowTitle}>
                          {member.title}
                        </span>
                        {isLatest(member.version, member.latestVersion)
                          ? null
                          : (
                            <span className={listStyles.meta}>
                              {t("documents.label.newer-version")}
                            </span>
                          )}
                        {member.archived
                          ? (
                            <span className={listStyles.meta}>
                              {t("documents.label.archived")}
                            </span>
                          )
                          : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
        </section>
        <section className={listStyles.section} data-next="">
          <h2 className={listStyles.sectionLabel}>
            {t("documents.heading.next")}
          </h2>
          <NextNote
            next={next}
            members={members.length}
            rule={series.nextRule}
          />
          {series.draft !== null && !series.archived
            ? (
              <div className={styles.draft} data-series-draft={series.draft.key}>
                <p className={listStyles.hint}>
                  {t("documents.notice.draft", { key: series.draft.key })}
                </p>
                {writable
                  ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-continue-draft=""
                      onClick={() => onWrite?.(series)}
                    >
                      {t("documents.button.continue-draft")}
                    </Button>
                  )
                  : null}
              </div>
            )
            : null}
          {series.archived ? null : (
            <form
              className={styles.addForm}
              onSubmit={(event) => void add(event)}
              data-add-member=""
            >
              <div className={styles.keyField}>
                <Field
                  label={t("documents.label.key")}
                  error={change.kind === "key-taken"
                    ? t("documents.error.key-taken")
                    : change.kind === "key-unnamed"
                    ? t("documents.error.key-unnamed")
                    : undefined}
                >
                  <Input
                    data-member-key=""
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                  />
                </Field>
              </div>
              <div className={listStyles.grow}>
                <Field
                  label={t("documents.label.member-document")}
                  help={candidates.length === 0
                    ? t("documents.empty.no-candidates")
                    : undefined}
                >
                  <Select
                    options={candidates.map((item) => ({
                      value: item.id,
                      label: item.title,
                    }))}
                    value={document}
                    placeholder={t("documents.label.choose-document")}
                    disabled={candidates.length === 0}
                    onValueChange={setDocument}
                  />
                </Field>
              </div>
              <Tooltip content={addLabel}>
                <IconButton
                  icon={lophnSpaceIcons.add}
                  label={addLabel}
                  type="submit"
                  variant="secondary"
                  data-add-member-submit=""
                  disabled={document === undefined || key.trim() === ""}
                />
              </Tooltip>
              {writable && series.draft === null
                ? (
                  <Tooltip content={writeLabel}>
                    <IconButton
                      icon={editorIcons.edit}
                      label={writeLabel}
                      type="button"
                      variant="secondary"
                      data-write-member=""
                      disabled={key.trim() === ""}
                      onClick={() => void write()}
                    />
                  </Tooltip>
                )
                : null}
            </form>
          )}
          {change.kind === "failed"
            ? (
              <p className={listStyles.error} data-change-failed="">
                {t("documents.error.change-failed")}
              </p>
            )
            : null}
        </section>
      </div>
    </OverviewFrame>
  );
}

// 다음 key 제안과 근거. 빈 가족이면 첫 key를 사람이 정한다(documents/series#R7).
function NextNote(
  { next, members, rule }: {
    next: NextSuggestion | null;
    members: number;
    rule: string;
  },
) {
  if (next === null) return null;
  if (next.key === "") {
    return (
      <p className={listStyles.hint} data-next-key="">
        {members === 0 || next.from === null
          ? t("documents.notice.first-key")
          : t("documents.notice.no-suggestion", { from: next.from })}
      </p>
    );
  }
  return (
    <div className={listStyles.section}>
      <p className={listStyles.hint} data-next-key={next.key}>
        {t("documents.notice.suggestion", {
          key: next.key,
          from: next.from ?? "",
          rule,
        })}
      </p>
      {next.taken
        ? (
          <p className={listStyles.notice} data-next-taken="">
            {t("documents.notice.suggestion-taken")}
          </p>
        )
        : null}
    </div>
  );
}
