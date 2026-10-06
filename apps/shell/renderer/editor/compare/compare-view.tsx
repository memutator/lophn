// 버전 비교 화면(shell/editor#R13, R14, flow restore-document 2·3·5·6단계). 문서 탭 본문 자리에
// 44px 도구 줄과 220px 바뀐 절 목록, 원문 13px/20px 줄 비교를 그린다. 줄 diff는 documents가
// 계산하고(documents.diff) 여기서는 두 판 본문과 맞춰 그리기만 한다. +/− 기호를 색과 함께 써서
// 색 없이도 읽히고, 같은 두 판이면 en message key의 These versions are identical를 보인다.
// 복원은 secondary 행동이다: primary 버튼을 두지 않고 확인 줄을 거친 뒤 결과를 그대로 보인다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  DiffMark,
  editorIcons,
  ErrorState,
  Icon,
  IconButton,
  iconPixels,
  Menu,
  Skeleton,
  useObservedSize,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { RestoreReport } from "../../../ipc/editor.ts";
import { sectionChangeLabel } from "../versions/versions-tab.tsx";
import type {
  SectionEntry,
  VersionRow,
  VersionSource,
} from "../versions/source.ts";
import {
  buildLines,
  changedSections,
  type CompareLine,
  type CompareRow,
  foldRows,
  identical,
  needsSection,
  pairRows,
  type SectionDelta,
  sectionSlice,
  sideBySideFits,
} from "./model.ts";
import styles from "./compare.module.css";

/** 복원 요청의 답. 파일·판 결과는 main이 준 그대로다. */
export type RestoreAnswer =
  | { readonly kind: "report"; readonly report: RestoreReport }
  | { readonly kind: "unsaved" }
  | { readonly kind: "failed"; readonly code: string };

export interface CompareViewProps {
  document: string;
  /** 옛 쪽(왼쪽·−) 판. */
  before: string;
  /** 새 쪽(오른쪽·+) 판. */
  after: string;
  source: VersionSource;
  onChange: (before: string, after: string) => void;
  onClose: () => void;
  /** 고른 판을 새 최신 판으로 되살린다. 없으면 복원 행동을 두지 않는다. */
  onRestore?: (version: string) => Promise<RestoreAnswer>;
  /** 복원으로 판이 바뀐 뒤. 이력과 문서 머리를 다시 읽는다. */
  onRestored?: () => void;
}

interface Compared {
  readonly lines: readonly CompareLine[] | null;
  readonly before: readonly SectionEntry[];
  readonly after: readonly SectionEntry[];
  readonly beforeText: string;
  readonly afterText: string;
  readonly omitted: boolean;
  readonly complete: boolean;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: Compared };

type RestoreNotice =
  | "restoring"
  | "saved"
  | "unchanged"
  | "conflict"
  | "file-conflict"
  | "pending"
  | "file-unknown"
  | "failed"
  | "unsupported"
  | "unsaved";

type NoticeKey =
  | "document.notice.restoring"
  | "document.notice.restore-saved"
  | "document.notice.restore-unchanged"
  | "document.notice.restore-conflict"
  | "document.notice.restore-file-conflict"
  | "document.notice.restore-pending"
  | "document.notice.restore-file-unknown"
  | "document.notice.restore-failed"
  | "document.notice.restore-unsupported"
  | "document.notice.restore-unsaved";

type HintKey =
  | "document.notice.side-by-side-narrow"
  | "document.notice.compare-omitted"
  | "document.notice.compare-incomplete";

const NOTICE_TEXT: Record<RestoreNotice, NoticeKey> = {
  restoring: "document.notice.restoring",
  saved: "document.notice.restore-saved",
  unchanged: "document.notice.restore-unchanged",
  conflict: "document.notice.restore-conflict",
  "file-conflict": "document.notice.restore-file-conflict",
  pending: "document.notice.restore-pending",
  "file-unknown": "document.notice.restore-file-unknown",
  failed: "document.notice.restore-failed",
  unsupported: "document.notice.restore-unsupported",
  unsaved: "document.notice.restore-unsaved",
};

/** main이 준 복원 결과를 사람에게 보일 notice 하나로. 파일 결과와 판 결과를 섞지 않는다. */
export function restoreNotice(answer: RestoreAnswer): RestoreNotice {
  if (answer.kind === "unsaved") return "unsaved";
  if (answer.kind === "failed") {
    return answer.code === "unsupported" ? "unsupported" : "failed";
  }
  const report = answer.report;
  switch (report.outcome) {
    case "saved":
      return "saved";
    case "unchanged":
      return "unchanged";
    case "conflict":
      return report.file === "conflict" ? "file-conflict" : "conflict";
    case "pending":
      return "pending";
    case "failed":
      return report.file === "unknown" ? "file-unknown" : "failed";
  }
}

function sectionCounts(delta: SectionDelta): string {
  return t("document.label.section-counts", {
    added: delta.added,
    removed: delta.removed,
  });
}

function changeMark(delta: SectionDelta): string {
  return delta.change === "added"
    ? "+"
    : delta.change === "missing"
    ? "−"
    : "±";
}

function UnifiedRows(
  { rows, lines, onUnfold }: {
    rows: readonly CompareRow[];
    lines: readonly CompareLine[];
    onUnfold: (start: number) => void;
  },
) {
  return (
    <table className={styles.table} data-compare-mode="unified">
      <tbody>
        {rows.map((row) => {
          if (row.kind === "fold") {
            return (
              <tr key={`f${row.start}`} className={styles.foldRow}>
                <td colSpan={4}>
                  <button
                    type="button"
                    className={styles.fold}
                    data-fold={row.start}
                    onClick={() => onUnfold(row.start)}
                  >
                    {t("document.button.show-unchanged", { count: row.count })}
                  </button>
                </td>
              </tr>
            );
          }
          const line = lines[row.index]!;
          return (
            <tr
              key={row.index}
              className={styles.row}
              data-diff={line.kind}
              data-line-index={row.index}
            >
              <td className={styles.number}>{line.oldNumber}</td>
              <td className={styles.number}>{line.newNumber}</td>
              <td className={styles.sign}>
                {line.kind === "same" ? null : <DiffMark kind={line.kind} />}
              </td>
              <td className={styles.text}>{line.text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Half(
  { line, side }: { line: CompareLine | null; side: "old" | "new" },
) {
  if (line === null) {
    return (
      <>
        <td className={styles.number} />
        <td className={styles.sign} />
        <td className={`${styles.text} ${styles.blank}`} />
      </>
    );
  }
  const kind = line.kind;
  return (
    <>
      <td className={styles.number} data-diff={kind}>
        {side === "old" ? line.oldNumber : line.newNumber}
      </td>
      <td className={styles.sign} data-diff={kind}>
        {kind === "same" ? null : <DiffMark kind={kind} />}
      </td>
      <td className={styles.text} data-diff={kind}>{line.text}</td>
    </>
  );
}

function SplitRows(
  { rows, lines, onUnfold }: {
    rows: readonly CompareRow[];
    lines: readonly CompareLine[];
    onUnfold: (start: number) => void;
  },
) {
  return (
    <table className={styles.table} data-compare-mode="split">
      <tbody>
        {pairRows(rows, lines).map((pair) => {
          if (pair.kind === "fold") {
            return (
              <tr key={`f${pair.start}`} className={styles.foldRow}>
                <td colSpan={6}>
                  <button
                    type="button"
                    className={styles.fold}
                    data-fold={pair.start}
                    onClick={() => onUnfold(pair.start)}
                  >
                    {t("document.button.show-unchanged", {
                      count: pair.count,
                    })}
                  </button>
                </td>
              </tr>
            );
          }
          return (
            <tr
              key={`${pair.old}-${pair.new}`}
              className={styles.pairRow}
              data-line-index={pair.old ?? pair.new ?? undefined}
            >
              <Half
                line={pair.old === null ? null : lines[pair.old]!}
                side="old"
              />
              <Half
                line={pair.new === null ? null : lines[pair.new]!}
                side="new"
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// 옛·새 쪽 판 고르기. 44px 도구 줄 안에 두려고 Field 대신 메뉴로 고른다.
function VersionPicker(
  { side, value, versions, onPick }: {
    side: "before" | "after";
    value: string;
    versions: readonly VersionRow[];
    onPick: (version: string) => void;
  },
) {
  const number = versions.find((row) => row.id === value)?.number;
  return (
    <Menu
      trigger={
        <Button variant="ghost" size="sm" data-compare-picker={side}>
          <span className={styles.hidden}>
            {side === "before"
              ? t("document.label.compare-before")
              : t("document.label.compare-after")}
          </span>
          {number === undefined
            ? "…"
            : t("document.label.version-number", { number })}
        </Button>
      }
      items={versions.map((row) => ({
        id: row.id,
        label: t("document.label.version-number", { number: row.number }),
        disabled: row.id === value,
      }))}
      onSelect={onPick}
      placement="corner"
    />
  );
}

export function CompareView(
  {
    document,
    before,
    after,
    source,
    onChange,
    onClose,
    onRestore,
    onRestored,
  }: CompareViewProps,
) {
  const [versions, setVersions] = useState<readonly VersionRow[]>([]);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [fold, setFold] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [section, setSection] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<RestoreNotice | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [, setScrollTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const size = useObservedSize(bodyRef);

  useEffect(() => {
    let live = true;
    void source.history(document).then((read) => {
      if (live && read.ok) setVersions(read.value);
    });
    return () => {
      live = false;
    };
  }, [document, source, historyKey]);

  useEffect(() => {
    let live = true;
    setLoaded({ kind: "loading" });
    setExpanded(new Set());
    setSection(null);
    void (async () => {
      const [diff, oldText, newText, oldSections, newSections] = await Promise
        .all([
          source.diff(document, before, after),
          source.text(document, before),
          source.text(document, after),
          source.sections(document, before),
          source.sections(document, after),
        ]);
      if (!live) return;
      if (!diff.ok) {
        setLoaded({ kind: "failed" });
        return;
      }
      // 한쪽 본문을 확인하지 못하면 documents는 변경 없이 누락만 준다. 같다고 그리지 않는다.
      const unknownSide = diff.value.additions.length === 0 &&
        diff.value.deletions.length === 0 && diff.value.omissions.length > 0;
      const lines = !unknownSide && oldText.ok && newText.ok
        ? buildLines(oldText.value, newText.value, diff.value)
        : null;
      setLoaded({
        kind: "ready",
        value: {
          lines,
          before: oldSections.ok ? oldSections.value : [],
          after: newSections.ok ? newSections.value : [],
          beforeText: oldText.ok ? oldText.value : "",
          afterText: newText.ok ? newText.value : "",
          omitted: diff.value.omissions.length > 0,
          complete: diff.value.complete,
        },
      });
    })();
    return () => {
      live = false;
    };
  }, [document, before, after, source, attempt]);

  const ready = loaded.kind === "ready" ? loaded.value : null;
  const lines = ready?.lines ?? null;
  const deltas = ready && lines
    ? changedSections(ready.before, ready.after, lines)
    : [];
  const long = ready !== null && lines !== null &&
    needsSection(ready.beforeText, ready.afterText) && deltas.length > 0;
  const fits = sideBySideFits(size?.width);
  const split = mode === "split" && fits;

  const sliceOf = (key: string) => {
    if (!ready || !lines) return null;
    const old = ready.before.find((entry) => entry.key === key) ?? null;
    const next = ready.after.find((entry) => entry.key === key) ?? null;
    return sectionSlice(lines, old?.subtree ?? null, next?.subtree ?? null);
  };
  const chosen = section === null ? null : sliceOf(section);
  const blocked = long && chosen === null;
  const rows: CompareRow[] = lines && !blocked
    ? foldRows(
      lines,
      expanded,
      fold,
      chosen?.from ?? 0,
      chosen?.to ?? lines.length,
    )
    : [];

  // 접힌 줄로 가는 이동은 펼친 뒤 그 줄이 생기면 scroll한다.
  useLayoutEffect(() => {
    const index = pendingScroll.current;
    const body = bodyRef.current;
    if (index === null || !body) return;
    const row = body.querySelector<HTMLElement>(
      `[data-line-index="${index}"]`,
    );
    if (!row) return;
    pendingScroll.current = null;
    body.scrollTop = Math.max(0, row.offsetTop - body.clientHeight / 3);
  });

  const goSection = (delta: SectionDelta) => {
    if (long) {
      setSection(delta.key);
      return;
    }
    const slice = sliceOf(delta.key);
    if (!slice) return;
    const folded = rows.find((row) =>
      row.kind === "fold" && slice.from >= row.start &&
      slice.from < row.start + row.count
    );
    if (folded && folded.kind === "fold") {
      setExpanded((current) => new Set(current).add(folded.start));
    }
    pendingScroll.current = slice.from;
    setScrollTick((value) => value + 1);
  };

  const latest = versions[0];
  const numberOf = (id: string) =>
    versions.find((row) => row.id === id)?.number;
  const restoreTarget = onRestore && latest && before !== latest.id &&
      versions.find((row) => row.id === before)?.restorable
    ? before
    : null;

  const restore = async () => {
    if (!onRestore || restoreTarget === null) return;
    setConfirming(false);
    setNotice("restoring");
    const answer = await onRestore(restoreTarget);
    const shown = restoreNotice(answer);
    setNotice(shown);
    if (shown === "saved" || shown === "pending" || shown === "unchanged") {
      setHistoryKey((value) => value + 1);
      onRestored?.();
    }
  };

  let body;
  if (loaded.kind === "loading") {
    body = (
      <div className={styles.state}>
        <Skeleton shape="line" lines={12} />
      </div>
    );
  } else if (loaded.kind === "failed") {
    body = (
      <div className={styles.state}>
        <ErrorState
          target={t("document.label.compare-target")}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  } else if (lines === null) {
    body = (
      <p className={styles.message} role="status" data-compare-state="unread">
        {t("document.notice.compare-unreadable")}
      </p>
    );
  } else if (identical(lines) && !ready!.omitted) {
    body = (
      <p
        className={styles.message}
        role="status"
        data-compare-state="identical"
      >
        {t("document.diff.identical")}
      </p>
    );
  } else if (blocked) {
    body = (
      <p className={styles.message} role="status" data-compare-state="pick">
        {t("document.notice.compare-pick-section")}
      </p>
    );
  } else {
    body = split
      ? (
        <SplitRows
          rows={rows}
          lines={lines}
          onUnfold={(start) =>
            setExpanded((current) => new Set(current).add(start))}
        />
      )
      : (
        <UnifiedRows
          rows={rows}
          lines={lines}
          onUnfold={(start) =>
            setExpanded((current) => new Set(current).add(start))}
        />
      );
  }

  const notes: HintKey[] = [];
  if (mode === "split" && !fits) notes.push("document.notice.side-by-side-narrow");
  if (ready?.omitted && lines !== null) {
    notes.push("document.notice.compare-omitted");
  }
  if (ready && !ready.complete) notes.push("document.notice.compare-incomplete");
  const targetNumber = restoreTarget === null ? undefined : numberOf(
    restoreTarget,
  );

  return (
    <section
      className={styles.view}
      data-compare-view=""
      aria-label={t("document.title.compare-versions")}
    >
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label={t("document.title.compare-versions")}
      >
        <IconButton
          icon={editorIcons.compareBack}
          size="sm"
          label={t("document.button.compare-close")}
          data-compare-close=""
          onClick={onClose}
        />
        <span className={styles.pair}>
          <VersionPicker
            side="before"
            value={before}
            versions={versions}
            onPick={(value) => onChange(value, after)}
          />
          <IconButton
            icon={editorIcons.compareSwap}
            size="sm"
            label={t("document.button.compare-swap")}
            data-compare-swap=""
            onClick={() => onChange(after, before)}
          />
          <VersionPicker
            side="after"
            value={after}
            versions={versions}
            onPick={(value) => onChange(before, value)}
          />
        </span>
        <span className={styles.group}>
          <IconButton
            icon={editorIcons.compareUnified}
            size="sm"
            variant={mode === "unified" ? "secondary" : "ghost"}
            aria-pressed={mode === "unified"}
            label={t("document.button.compare-unified")}
            data-compare-mode-button="unified"
            onClick={() => setMode("unified")}
          />
          <IconButton
            icon={editorIcons.compareSideBySide}
            size="sm"
            variant={split ? "secondary" : "ghost"}
            aria-pressed={mode === "split"}
            label={t("document.button.compare-side-by-side")}
            data-compare-mode-button="split"
            onClick={() => setMode("split")}
          />
        </span>
        <span className={styles.group}>
          <IconButton
            icon={fold
              ? editorIcons.compareAllLines
              : editorIcons.compareChangesOnly}
            size="sm"
            aria-pressed={!fold}
            label={fold
              ? t("document.button.compare-all-lines")
              : t("document.button.compare-changes-only")}
            data-compare-fold={fold ? "changes" : "all"}
            onClick={() => setFold(!fold)}
          />
        </span>
        {restoreTarget !== null && targetNumber !== undefined
          ? (
            <span className={styles.end}>
              <IconButton
                icon={editorIcons.restore}
                size="sm"
                variant="secondary"
                label={t("document.button.restore-version", {
                  number: targetNumber,
                })}
                data-compare-restore={targetNumber}
                disabled={notice === "restoring"}
                onClick={() => {
                  setNotice(null);
                  setConfirming(true);
                }}
              />
            </span>
          )
          : null}
      </div>
      {confirming && targetNumber !== undefined
        ? (
          <div className={styles.confirm} data-restore-confirm="">
            <span className={styles.noteText}>
              {t("document.notice.restore-confirm", { number: targetNumber })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-restore-confirm-button=""
              onClick={() => void restore()}
            >
              {t("document.button.restore-confirm")}
            </Button>
          </div>
        )
        : null}
      {notice !== null
        ? (
          <div
            className={styles.note}
            data-restore-notice={notice}
            role={notice === "restoring" ? "status" : "alert"}
          >
            <Icon
              icon={notice === "saved" || notice === "unchanged" ||
                  notice === "restoring"
                ? editorIcons.restore
                : editorIcons.saveWarning}
              pixels={iconPixels("small")}
              className={styles.noteIcon}
            />
            <span className={styles.noteText}>{t(NOTICE_TEXT[notice])}</span>
          </div>
        )
        : null}
      {notes.map((key) => (
        <p key={key} className={styles.hint} role="status" data-compare-note="">
          {t(key)}
        </p>
      ))}
      <div className={styles.main}>
        {deltas.length > 0
          ? (
            <nav
              className={styles.rail}
              aria-label={t("document.label.changed-sections")}
              data-compare-rail=""
            >
              <h3 className={styles.railTitle}>
                {t("document.label.changed-sections")}
              </h3>
              <ul className={styles.railList}>
                {deltas.map((delta) => (
                  <li key={delta.key}>
                    <button
                      type="button"
                      className={styles.railItem}
                      aria-current={section === delta.key || undefined}
                      data-compare-section={delta.key}
                      data-change={delta.change}
                      onClick={() => goSection(delta)}
                    >
                      <span className={styles.railMark} aria-hidden="true">
                        {changeMark(delta)}
                      </span>
                      <span className={styles.railName}>{delta.title}</span>
                      <span className={styles.hidden}>
                        {sectionChangeLabel(delta.change)}
                      </span>
                      <span className={styles.railCount}>
                        {sectionCounts(delta)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )
          : null}
        <div
          ref={bodyRef}
          className={styles.body}
          role="region"
          tabIndex={0}
          aria-label={t("document.title.compare-versions")}
          data-compare-body=""
        >
          {body}
        </div>
      </div>
    </section>
  );
}
