import { type FormEvent, useState } from "react";
import {
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  iconPixels,
  Input,
  Select,
  type SelectOption,
  Tooltip,
} from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import {
  EMPTY_CONDITIONS,
  emptyHint,
  isLatest,
  placeOf,
  placeValue,
} from "../model.ts";
import type {
  ArchivedHit,
  Catalog,
  LophnSource,
  SearchConditions,
  SearchHit,
  SearchPage,
} from "../source.ts";
import { CoverageNotices, formatLabel } from "./notices.tsx";
import type { ReaderTarget } from "./reader.tsx";
import styles from "./documents.module.css";

const ANY = "any";

export interface SearchPanelProps {
  source: LophnSource;
  catalog: Catalog;
  formats: readonly string[];
  /** 지금 상세에서 읽는 문서. */
  current: string | null;
  onRead: (target: ReaderTarget) => void;
}

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "failed"; readonly conditions: SearchConditions }
  | {
    readonly kind: "done";
    readonly conditions: SearchConditions;
    readonly page: SearchPage;
    readonly archived: readonly ArchivedHit[];
  };

// 검색어와 자리·format 조건, 보관 포함. 결과는 제목과 짧은 근거만 보이고 본문은 열 때 읽는다.
export function SearchPanel(
  { source, catalog, formats, current, onRead }: SearchPanelProps,
) {
  const [conditions, setConditions] = useState<SearchConditions>(
    EMPTY_CONDITIONS,
  );
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [linkOpen, setLinkOpen] = useState(false);

  const run = async (next: SearchConditions) => {
    setConditions(next);
    if (next.query.trim() === "") return;
    const [page, archived] = await Promise.all([
      source.search(next),
      next.includeArchived
        ? source.archived(next)
        : Promise.resolve({ ok: true as const, value: [] }),
    ]);
    if (!page.ok || !archived.ok) {
      setOutcome({ kind: "failed", conditions: next });
      return;
    }
    setOutcome({
      kind: "done",
      conditions: next,
      page: page.value,
      archived: archived.value,
    });
  };

  const more = async () => {
    if (outcome.kind !== "done" || outcome.page.nextCursor === null) return;
    const page = await source.search(
      outcome.conditions,
      outcome.page.nextCursor,
    );
    if (!page.ok) return;
    setOutcome({
      ...outcome,
      page: {
        hits: [...outcome.page.hits, ...page.value.hits],
        coverage: page.value.coverage,
        nextCursor: page.value.nextCursor,
      },
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(conditions);
  };

  const placeOptions: SelectOption[] = [
    { value: ANY, label: t("documents.label.any-place") },
    ...catalog.projects.map((item) => ({
      value: placeValue({ kind: "project", id: item.id }),
      label: item.title,
    })),
    ...catalog.apps.map((item) => ({
      value: placeValue({ kind: "app", id: item.id }),
      label: item.title,
    })),
  ];
  const formatOptions: SelectOption[] = [
    { value: ANY, label: t("documents.label.any-format") },
    ...formats.map((name) => ({ value: name, label: formatLabel(name) })),
  ];
  const searchLabel = t("documents.button.search");
  const linkLabel = t("documents.button.open-link");

  return (
    <div className={styles.section} data-panel="search">
      <form className={styles.form} onSubmit={submit} data-search-form="">
        <div className={styles.inline}>
          <div className={styles.grow}>
            <Field label={t("documents.label.query")}>
              <Input
                data-search-input=""
                type="search"
                value={conditions.query}
                onChange={(event) =>
                  setConditions({ ...conditions, query: event.target.value })}
              />
            </Field>
          </div>
          <Tooltip content={searchLabel}>
            <IconButton
              icon={lophnSpaceIcons.search}
              label={searchLabel}
              type="submit"
              variant="secondary"
              data-search-submit=""
            />
          </Tooltip>
        </div>
        <div className={styles.conditions}>
          <Field label={t("documents.label.place")}>
            <Select
              size="sm"
              options={placeOptions}
              value={conditions.place === null
                ? ANY
                : placeValue(conditions.place)}
              onValueChange={(value) =>
                void run({ ...conditions, place: placeOf(value) })}
            />
          </Field>
          <Field label={t("documents.label.format")}>
            <Select
              size="sm"
              options={formatOptions}
              value={conditions.format ?? ANY}
              onValueChange={(value) =>
                void run({
                  ...conditions,
                  format: value === ANY ? null : value,
                })}
            />
          </Field>
        </div>
        <div className={styles.toolbar}>
          <Checkbox
            label={t("documents.label.include-archived")}
            checked={conditions.includeArchived}
            onCheckedChange={(checked) =>
              void run({ ...conditions, includeArchived: checked })}
          />
          <span className={styles.inline}>
            <Tooltip content={linkLabel}>
              <IconButton
                icon={lophnSpaceIcons.openLink}
                label={linkLabel}
                aria-expanded={linkOpen}
                data-open-link=""
                onClick={() => setLinkOpen(!linkOpen)}
              />
            </Tooltip>
          </span>
        </div>
      </form>
      {linkOpen ? <OpenLink source={source} onRead={onRead} /> : null}
      <Results
        outcome={outcome}
        current={current}
        onRead={onRead}
        onMore={() => void more()}
        onRetry={() => {
          if (outcome.kind === "failed") void run(outcome.conditions);
        }}
        onIncludeArchived={() =>
          void run({ ...conditions, includeArchived: true })}
        onClear={() =>
          void run({ ...EMPTY_CONDITIONS, query: conditions.query })}
      />
    </div>
  );
}

interface ResultsProps {
  outcome: Outcome;
  current: string | null;
  onRead: (target: ReaderTarget) => void;
  onMore: () => void;
  onRetry: () => void;
  onIncludeArchived: () => void;
  onClear: () => void;
}

function Results(
  {
    outcome,
    current,
    onRead,
    onMore,
    onRetry,
    onIncludeArchived,
    onClear,
  }: ResultsProps,
) {
  if (outcome.kind === "idle") {
    return <p className={styles.hint}>{t("documents.empty.start")}</p>;
  }
  if (outcome.kind === "failed") {
    return (
      <ErrorState
        target={t("documents.label.target-results")}
        onRetry={onRetry}
      />
    );
  }
  const { page, archived, conditions } = outcome;
  const empty = page.hits.length === 0 && archived.length === 0;
  const hint = emptyHint(page.coverage, conditions.includeArchived);
  const moreLabel = t("documents.button.more-results");
  return (
    <div className={styles.section} data-results="">
      <CoverageNotices coverage={page.coverage} />
      {empty
        ? (
          <EmptyState
            icon={lophnSpaceIcons.noResults}
            message={hint === "not-yet"
              ? t("documents.empty.no-matches-not-yet")
              : hint === "archived"
              ? t("documents.empty.no-matches-active")
              : t("documents.empty.no-matches")}
            action={hint === "not-yet"
              ? { label: t("documents.button.search-again"), onSelect: onRetry }
              : hint === "archived"
              ? {
                label: t("documents.button.include-archived"),
                onSelect: onIncludeArchived,
              }
              : {
                label: t("documents.button.clear-conditions"),
                onSelect: onClear,
              }}
          />
        )
        : null}
      {page.hits.length > 0
        ? (
          <ul className={styles.rows} data-hits="">
            {page.hits.map((hit) => (
              <li key={`${hit.document}:${hit.section ?? ""}`}>
                <HitRow
                  hit={hit}
                  active={hit.document === current}
                  onRead={onRead}
                />
              </li>
            ))}
          </ul>
        )
        : null}
      {page.nextCursor !== null
        ? (
          <div className={styles.more}>
            <Tooltip content={moreLabel}>
              <IconButton
                icon={lophnSpaceIcons.readMore}
                label={moreLabel}
                data-more-results=""
                onClick={onMore}
              />
            </Tooltip>
          </div>
        )
        : null}
      {archived.length > 0
        ? (
          <div className={styles.section} data-archived-hits="">
            <h3 className={styles.sectionLabel}>
              {t("documents.label.archived-results")}
            </h3>
            <ul className={styles.rows}>
              {archived.map((hit) => (
                <li key={hit.document}>
                  <button
                    type="button"
                    className={styles.row}
                    data-hit={hit.document}
                    aria-current={hit.document === current ? "true" : undefined}
                    onClick={() =>
                      onRead({
                        document: hit.document,
                        version: hit.version,
                        section: null,
                      })}
                  >
                    <span className={styles.rowHead}>
                      <Icon
                        icon={lophnSpaceIcons.archive}
                        pixels={iconPixels("base")}
                        className={styles.rowIcon}
                      />
                      <span className={styles.rowTitle}>{hit.title}</span>
                    </span>
                    <span className={styles.meta}>
                      <span>{formatLabel(hit.format)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
        : null}
    </div>
  );
}

function HitRow(
  { hit, active, onRead }: {
    hit: SearchHit;
    active: boolean;
    onRead: (target: ReaderTarget) => void;
  },
) {
  return (
    <button
      type="button"
      className={styles.row}
      data-hit={hit.document}
      aria-current={active ? "true" : undefined}
      onClick={() =>
        onRead({
          document: hit.document,
          version: hit.version,
          section: hit.section,
        })}
    >
      <span className={styles.rowHead}>
        <Icon
          icon={lophnSpaceIcons.documents}
          pixels={iconPixels("base")}
          className={styles.rowIcon}
        />
        <span className={styles.rowTitle}>{hit.title}</span>
      </span>
      <span className={styles.snippet} data-snippet="">{hit.snippet}</span>
      <span className={styles.meta}>
        <span>{formatLabel(hit.format)}</span>
        {hit.fromSummary
          ? <span>{t("documents.label.from-summary")}</span>
          : null}
        {isLatest(hit.version, hit.latestVersion)
          ? null
          : (
            <span data-newer-version="">
              {t("documents.label.newer-version")}
            </span>
          )}
      </span>
    </button>
  );
}

function OpenLink(
  { source, onRead }: {
    source: LophnSource;
    onRead: (target: ReaderTarget) => void;
  },
) {
  const [link, setLink] = useState("");
  const [unknown, setUnknown] = useState(false);
  const label = t("documents.button.open-link");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await source.resolve(link);
    if (!result.ok || result.value === null) {
      setUnknown(true);
      return;
    }
    setUnknown(false);
    const resolved = result.value;
    onRead({
      document: resolved.document,
      version: resolved.version,
      section: resolved.section,
      link: resolved,
    });
  };
  return (
    <form
      className={styles.inline}
      onSubmit={(event) => void submit(event)}
      data-link-form=""
    >
      <div className={styles.grow}>
        <Field
          label={t("documents.label.link")}
          help={unknown ? undefined : t("documents.label.link-help")}
          error={unknown ? t("documents.error.link-unknown") : undefined}
        >
          <Input
            data-link-input=""
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
        </Field>
      </div>
      <Tooltip content={label}>
        <IconButton
          icon={lophnSpaceIcons.openLink}
          label={label}
          type="submit"
          variant="secondary"
          data-link-submit=""
        />
      </Tooltip>
    </form>
  );
}
