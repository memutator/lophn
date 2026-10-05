// 문서 탭 본문: 같은 기둥에서 읽고 고친다(shell/editor#R4, R8, R9, R16, design-system#R23).
// 읽기는 design의 Markdown renderer, 편집은 CodeMirror다. 둘은 같은 ReadingFrame·머리·
// scroll 칸을 쓰고 본문 자리만 바뀌어 전환 전후 첫 블록 위치가 같다. 고친 글은 이 화면의
// 초안으로만 남는다. 디스크 저장은 shell#T17의 저장 흐름이 맡는다.
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ErrorState,
  Loading,
  READING_WIDTHS,
  ReadingFrame,
  Skeleton,
  useReadingWidth,
} from "@lophn/design/components";
import { Markdown, Toc } from "@lophn/design/reading";
import { formatRelativeTime, t } from "@lophn/wording";

import { DocumentHead, StickyHeadBar } from "./document-head.tsx";
import type { MenuOpener } from "./document-menu.ts";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.tsx";
import { type HeadingTop, stickyHead, type StickyHead } from "./model.ts";
import type { EditorProblem } from "./problems-gutter/problems.ts";
import type { LinkTarget } from "./link-picker/link-picker.ts";
import type { ReadingWidthStore } from "./reading-width.ts";
import type {
  BodyState,
  DocumentInfo,
  EditorSource,
  OutlineSection,
} from "./source.ts";
import styles from "./document-view.module.css";

/** 탭 제목·tooltip에 쓰는 문서 정보(R4). */
export interface DocumentTabMeta {
  readonly fileName: string;
  readonly title: string;
  readonly path: string | null;
}

/** 문서 탭이 쓰는 통로. 창마다 entry가 만들어 넘긴다. */
export interface EditorDeps {
  readonly source: EditorSource;
  readonly readingWidth: ReadingWidthStore;
  readonly menu: MenuOpener;
}

export interface DocumentViewProps extends EditorDeps {
  documentId: string;
  projectId: string;
  infoOpen?: boolean;
  onToggleInfo?: () => void;
  /** 형식 검사 문제. 저장 흐름(shell#T17)이 준비 결과에서 넘긴다. */
  problems?: readonly EditorProblem[];
  onMeta?: (meta: DocumentTabMeta) => void;
  /** 문서 링크를 따라 다른 문서를 연다. */
  onOpenDocument?: (document: string) => void;
  now?: () => number;
}

type InfoState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly info: DocumentInfo };

type Notice = "width-failed" | "menu-unavailable" | null;

const STICKY_HEIGHT = 32;
const HIDDEN_STICKY: StickyHead = { shown: false, section: null };

function bodyText(body: BodyState): string | null {
  return body.kind === "text" ? body.text : null;
}

// 본문이 없는 이유. documents가 준 상태만 옮긴다.
function bodyError(body: BodyState) {
  switch (body.kind) {
    case "hidden":
      return t("document.error.text-hidden");
    case "unreadable":
      return t("document.error.text-unreadable");
    case "unsupported":
      return t("document.error.text-unsupported");
    default:
      return t("document.error.load-failed");
  }
}

export function DocumentView(
  {
    documentId,
    projectId,
    source,
    readingWidth,
    menu,
    infoOpen = false,
    onToggleInfo,
    problems = [],
    onMeta,
    onOpenDocument,
    now = Date.now,
  }: DocumentViewProps,
) {
  const [state, setState] = useState<InfoState>({ kind: "loading" });
  const [body, setBody] = useState<BodyState>({ kind: "loading" });
  const [sections, setSections] = useState<readonly OutlineSection[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [links, setLinks] = useState<readonly LinkTarget[]>([]);
  const [sticky, setSticky] = useState<StickyHead>(HIDDEN_STICKY);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useReadingWidth(readingWidth);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const latest = useRef({ onMeta });
  latest.current = { onMeta };

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    setBody({ kind: "loading" });
    setSections([]);
    setDraft(null);
    setEditing(false);
    void (async () => {
      const read = await source.document(documentId);
      if (!live) return;
      if (!read.ok) {
        setState({ kind: "failed" });
        return;
      }
      const info = read.value;
      setState({ kind: "ready", info });
      latest.current.onMeta?.({
        fileName: info.fileName,
        title: info.title,
        path: info.path,
      });
      const [outline] = await Promise.all([
        source.outline(info.id, info.version),
        source.body(info.id, info.version, (page) => {
          if (live) setBody(page);
        }).then((final) => {
          if (live) setBody(final);
        }),
      ]);
      if (live && outline.ok) setSections(outline.value);
    })();
    return () => {
      live = false;
    };
  }, [documentId, source, attempt]);

  useEffect(() => {
    void readingWidth.load();
  }, [readingWidth]);

  useEffect(() =>
    readingWidth.subscribe(() => {
      setNotice(readingWidth.failed() ? "width-failed" : null);
    }), [readingWidth]);

  // 편집을 시작할 때만 링크 후보를 읽는다.
  useEffect(() => {
    if (!editing) return;
    let live = true;
    void source.linkTargets(projectId).then((result) => {
      if (live && result.ok) setLinks(result.value);
    });
    return () => {
      live = false;
    };
  }, [editing, projectId, source]);

  const text = draft ?? bodyText(body);
  const canEdit = body.kind === "text" && body.complete;

  const toggleEdit = useCallback(() => {
    if (!canEdit) return;
    setEditing((current) => !current);
  }, [canEdit]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const headingTops = useCallback((): HeadingTop[] => {
    const scroller = scrollRef.current;
    const article = articleRef.current;
    if (!scroller || !article) return [];
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    if (editing) {
      return sections.map((section) => ({
        title: section.title,
        top: (editorRef.current?.lineTop(section.line) ?? 0) - base,
      }));
    }
    const headings = article.querySelectorAll("h1, h2, h3, h4, h5, h6");
    return sections.flatMap((section, index) => {
      const heading = headings[index];
      return heading
        ? [{
          title: section.title,
          top: heading.getBoundingClientRect().top - base,
        }]
        : [];
    });
  }, [editing, sections]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    const title = titleRef.current;
    if (!scroller || !title) return;
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const titleBottom = title.getBoundingClientRect().bottom - base;
    const next = stickyHead(
      titleBottom,
      scroller.scrollTop,
      headingTops(),
      STICKY_HEIGHT,
    );
    setSticky((current) =>
      current.shown === next.shown && current.section === next.section
        ? current
        : next
    );
  };

  const goToSection = (key: string) => {
    const index = sections.findIndex((section) => section.key === key);
    const section = sections[index];
    const scroller = scrollRef.current;
    if (!section || !scroller) return;
    const top = headingTops().find((item, at) =>
      at === index && item.title === section.title
    )?.top;
    if (top !== undefined) scroller.scrollTop = Math.max(0, top - STICKY_HEIGHT);
  };

  const openLink = (href: string) => {
    void source.resolveLink(href).then((result) => {
      if (result.ok && result.value !== null) onOpenDocument?.(result.value);
    });
  };

  const openMenu = (anchor: HTMLElement) => {
    void menu.open(
      anchor,
      t("document.label.reading-width"),
      READING_WIDTHS.map((choice) => ({
        id: choice,
        label: choice === width
          ? t("document.label.width-current", { width: choice })
          : t("document.label.width-choice", { width: choice }),
      })),
    ).then((chosen) => {
      if (chosen === "unavailable") {
        setNotice("menu-unavailable");
        return;
      }
      const picked = READING_WIDTHS.find((choice) => choice === chosen);
      if (picked) setWidth(picked);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (
      mod && !event.altKey && !event.shiftKey &&
      event.key.toLowerCase() === "e"
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleEdit();
    }
  };

  if (state.kind === "failed") {
    return (
      <div className={styles.scroll} data-document-view="failed">
        <ReadingFrame width={width}>
          <ErrorState
            target={t("document.label.this-document")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </ReadingFrame>
      </div>
    );
  }

  const info = state.kind === "ready" ? state.info : null;
  const meta = info
    ? t("document.label.meta", {
      number: info.versionNumber,
      when: formatRelativeTime(new Date(info.savedAt), new Date(now())),
    })
    : "";

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      data-document-view={editing ? "edit" : "read"}
      data-reading-width={width}
      onScroll={onScroll}
      onKeyDownCapture={onKeyDown}
    >
      {sticky.shown && info
        ? <StickyHeadBar title={info.title} section={sticky.section} />
        : null}
      <ReadingFrame
        width={width}
        header={info
          ? (
            <>
              <DocumentHead
                title={info.title}
                meta={meta}
                editing={editing}
                canEdit={canEdit}
                onToggleEdit={toggleEdit}
                infoOpen={infoOpen}
                onToggleInfo={onToggleInfo}
                onMenu={openMenu}
                titleRef={titleRef}
              />
              {notice
                ? (
                  <p className={styles.headNotice} role="status">
                    {notice === "width-failed"
                      ? t("document.error.width-failed")
                      : t("common.overlay.unavailable")}
                  </p>
                )
                : null}
            </>
          )
          : <Skeleton shape="line" lines={2} />}
        toc={sections.length > 0
          ? (
            <Toc
              items={sections.map((section) => ({
                id: section.key,
                title: section.title,
                level: section.level,
              }))}
              activeId={sections.find((section) =>
                section.title === sticky.section
              )?.key}
              onSelect={goToSection}
            />
          )
          : undefined}
      >
        <div ref={articleRef} className={styles.article} data-document-body="">
          <Loading
            loading={body.kind === "loading"}
            placeholder={<Skeleton shape="line" lines={6} />}
          >
            {text === null
              ? (
                <p className={styles.bodyNotice} role="status">
                  {bodyError(body)}
                </p>
              )
              : editing
              ? (
                <MarkdownEditor
                  ref={editorRef}
                  initialText={text}
                  label={info?.title ?? ""}
                  problems={problems}
                  linkTargets={links}
                  onChange={setDraft}
                  onOpenLink={openLink}
                />
              )
              : <Markdown source={text} onOpenLink={openLink} />}
          </Loading>
        </div>
      </ReadingFrame>
    </div>
  );
}
