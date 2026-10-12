import { useEffect, useState } from "react";
import {
  ErrorState,
  IconButton,
  ReadingFrame,
  Tooltip,
} from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../icons/mod.ts";
import { Markdown, Toc } from "@lophn/design/reading";
import { formatRelativeTime, t } from "@lophn/wording";

import { isLatest } from "../model.ts";
import type {
  DocumentHead,
  DocumentOutline,
  LophnSource,
  ReadPage,
  Resolved,
  SectionStatus,
  SeriesMember,
} from "../source.ts";
import styles from "./reader.module.css";

/** 상세에서 읽을 문서. version이 null이면 지금 최신 판을 고정해 읽는다. */
export interface ReaderTarget {
  readonly document: string;
  readonly version: string | null;
  readonly section: string | null;
  /** 링크로 열었다. 옮겨진 옛 참조·지정 판을 알린다. */
  readonly link?: Resolved;
  /** series의 순서대로 읽는 중이다. */
  readonly sequence?: {
    readonly series: string;
    readonly members: readonly SeriesMember[];
    readonly index: number;
  };
}

export interface ReaderProps {
  source: LophnSource;
  target: ReaderTarget;
  now: () => number;
  /** 다른 판이나 문서를 연다. 최신 판 열기가 쓴다. */
  onOpen: (target: ReaderTarget) => void;
  /** series 상세로 돌아간다. series에서 열었을 때만 준다. */
  onBack?: () => void;
  /** series의 앞·뒤 멤버를 연다. */
  onStep?: (index: number) => void;
}

type Fixed =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
    readonly kind: "ready";
    readonly outline: DocumentOutline;
    readonly head: DocumentHead | null;
  };

type Body =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly page: ReadPage; readonly text: string };

const WHOLE = "";

// 고른 문서의 고정 판을 목차부터 읽는다. section을 고르면 그 범위만, [Read more]는 같은
// 판의 다음 범위만 읽는다. 최신 판은 따로 알리고 섞지 않는다.
export function Reader(
  { source, target, now, onOpen, onBack, onStep }: ReaderProps,
) {
  const [fixed, setFixed] = useState<Fixed>({ kind: "loading" });
  const [section, setSection] = useState<string | null>(target.section);
  const [body, setBody] = useState<Body>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFixed({ kind: "loading" });
    void source.outline(target.document, target.version).then(
      async (outline) => {
        if (!live) return;
        if (!outline.ok) {
          setFixed({ kind: "failed" });
          return;
        }
        const head = await source.head(target.document, outline.value.version);
        if (!live) return;
        setFixed({
          kind: "ready",
          outline: outline.value,
          head: head.ok ? head.value : null,
        });
      },
    );
    return () => {
      live = false;
    };
  }, [source, target.document, target.version, attempt]);

  const version = fixed.kind === "ready" ? fixed.outline.version : null;

  useEffect(() => {
    if (version === null) return;
    let live = true;
    setBody({ kind: "loading" });
    void source.read(target.document, version, section).then((page) => {
      if (!live) return;
      setBody(
        page.ok
          ? { kind: "ready", page: page.value, text: page.value.text ?? "" }
          : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, target.document, version, section]);

  // 같은 판·같은 section의 cursor로만 이어 읽는다.
  const readMore = async () => {
    if (
      version === null || body.kind !== "ready" ||
      body.page.nextCursor === null
    ) return;
    const page = await source.read(
      target.document,
      version,
      section,
      body.page.nextCursor,
    );
    if (!page.ok) {
      setBody({ kind: "failed" });
      return;
    }
    setBody({
      kind: "ready",
      page: page.value,
      text: body.text + (page.value.text ?? ""),
    });
  };

  if (fixed.kind === "loading") return null;
  if (fixed.kind === "failed") {
    return (
      <div className={styles.state} data-reader-failed="">
        <ErrorState
          target={t("documents.label.target-document")}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  }

  const { outline, head } = fixed;
  const latest = isLatest(outline.version, outline.latestVersion);
  const items = [
    { id: WHOLE, title: t("documents.label.whole-document"), level: 1 },
    ...outline.sections.map((item) => ({
      id: item.key,
      title: item.title,
      level: item.level,
    })),
  ];
  const sequence = target.sequence;
  const openLatest = t("documents.button.open-latest");
  const readMoreLabel = t("documents.button.read-more");

  const header = (
    <div className={styles.head} data-reader-head="">
      {sequence && onBack && onStep
        ? (
          <div className={styles.sequence} data-sequence="">
            <Tooltip content={t("documents.button.back-to-series")}>
              <IconButton
                icon={lophnSpaceIcons.back}
                label={t("documents.button.back-to-series")}
                data-back-to-series=""
                onClick={onBack}
              />
            </Tooltip>
            <span className={styles.key}>
              {sequence.members[sequence.index]?.key}
            </span>
            <Tooltip content={t("documents.button.previous-in-series")}>
              <IconButton
                icon={lophnSpaceIcons.previous}
                label={t("documents.button.previous-in-series")}
                data-previous=""
                disabled={sequence.index === 0}
                onClick={() => onStep(sequence.index - 1)}
              />
            </Tooltip>
            <Tooltip content={t("documents.button.next-in-series")}>
              <IconButton
                icon={lophnSpaceIcons.next}
                label={t("documents.button.next-in-series")}
                data-next=""
                disabled={sequence.index >= sequence.members.length - 1}
                onClick={() => onStep(sequence.index + 1)}
              />
            </Tooltip>
          </div>
        )
        : null}
      <h1 className={styles.title}>{head?.title ?? ""}</h1>
      <p className={styles.meta} data-reader-meta="">
        {head === null ? null : (
          <span>
            {t("document.label.meta", {
              number: head.versionNumber,
              when: formatRelativeTime(new Date(head.savedAt), new Date(now())),
            })}
          </span>
        )}
        <span
          data-version-state={latest ? "latest" : "older"}
          className={latest ? undefined : styles.older}
        >
          {latest
            ? t("documents.label.latest-version")
            : t("documents.label.newer-version")}
        </span>
        {latest ? null : (
          <Tooltip content={openLatest}>
            <IconButton
              icon={lophnSpaceIcons.openLatest}
              label={openLatest}
              size="sm"
              data-open-latest=""
              onClick={() =>
                onOpen({
                  document: target.document,
                  version: null,
                  section,
                })}
            />
          </Tooltip>
        )}
      </p>
      <LinkNotes link={target.link} head={head} />
      {head?.status === "archived"
        ? (
          <p className={styles.note} data-archived-document="">
            {t("documents.notice.archived-document")}
          </p>
        )
        : null}
    </div>
  );

  const toc = outline.sections.length > 0
    ? (
      <Toc
        items={items}
        activeId={section ?? WHOLE}
        onSelect={(id) => setSection(id === WHOLE ? null : id)}
      />
    )
    : undefined;

  return (
    <div className={styles.reader} data-reader={target.document}>
      <ReadingFrame width="default" header={header} toc={toc}>
        <BodyView body={body} />
        {body.kind === "ready" && body.page.nextCursor !== null
          ? (
            <div className={styles.more}>
              <Tooltip content={readMoreLabel}>
                <IconButton
                  icon={lophnSpaceIcons.readMore}
                  label={readMoreLabel}
                  variant="secondary"
                  data-read-more=""
                  onClick={() => void readMore()}
                />
              </Tooltip>
            </div>
          )
          : null}
      </ReadingFrame>
    </div>
  );
}

function LinkNotes(
  { link, head }: { link?: Resolved; head: DocumentHead | null },
) {
  if (link === undefined) return null;
  return (
    <>
      {link.moved
        ? (
          <p className={styles.note} data-link-moved="">
            {link.current === null
              ? t("documents.notice.link-moved-unplaced")
              : t("documents.notice.link-moved", { address: link.current })}
          </p>
        )
        : null}
      {link.pinned && head !== null
        ? (
          <p className={styles.note} data-link-pinned="">
            {t("documents.notice.pinned-version", {
              number: head.versionNumber,
            })}
          </p>
        )
        : null}
    </>
  );
}

function BodyView({ body }: { body: Body }) {
  if (body.kind === "loading") return null;
  if (body.kind === "failed") {
    return (
      <p className={styles.note} data-body-failed="">
        {t("documents.error.read-failed")}
      </p>
    );
  }
  const status = body.page.status;
  if (
    status === "missing" || status === "unsupported" || status === "unverified"
  ) {
    return (
      <p className={styles.note} data-section-status={status}>
        {statusMessage(status)}
      </p>
    );
  }
  if (body.page.hidden) {
    return (
      <p className={styles.note} data-body-hidden="">
        {t("documents.error.text-hidden")}
      </p>
    );
  }
  return (
    <div data-body="" data-complete={body.page.complete ? "" : undefined}>
      <Markdown source={body.text} />
    </div>
  );
}

// 없는 section, section 없는 format, 아직 읽지 못한 구조를 서로 다른 말로 보인다
// (outline-and-search#R22). 비슷한 section으로 대신 가지 않는다.
function statusMessage(status: SectionStatus): string {
  if (status === "missing") return t("documents.error.section-missing");
  if (status === "unsupported") return t("documents.error.section-unsupported");
  return t("documents.error.section-unverified");
}
