// 문서 탭 본문: 같은 기둥에서 읽고 고친다(shell/editor#R4, R8, R9, R16, design-system#R23).
// 읽기는 design의 Markdown renderer, 편집은 CodeMirror다. 둘은 같은 ReadingFrame·머리·
// scroll 칸을 쓰고 본문 자리만 바뀌어 전환 전후 첫 블록 위치가 같다. 편집을 시작하면 main의
// 파일 adapter로 지금 디스크 글을 열고, 고침은 저장 버튼 없이 저장 흐름(save-state.ts)으로
// 보낸다(R1, R2, R12). 저장 상태는 머리 메타 줄에, 충돌은 문서 옆 notice와 해결 화면에 보인다(R15).
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

import { useConnectionSafe } from "../desktop/connection/connection.tsx";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { ConflictView } from "./conflict/conflict-view.tsx";
import { CompareView, type RestoreAnswer } from "./compare/compare-view.tsx";
import { DocumentHead, StickyHeadBar } from "./document-head.tsx";
import type { MenuOpener } from "./document-menu.ts";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.tsx";
import { type HeadingTop, type StickyHead, stickyHead } from "./model.ts";
import { NoticeBar } from "./notice-bar.tsx";
import {
  type EditorProblem,
  editorProblems,
} from "./problems-gutter/problems.ts";
import {
  type NoticeKind,
  type SaveAction,
  type SaveFacts,
  saveHeadline,
  saveNotices,
  topNotice,
} from "./save-state.ts";
import { INITIAL_FACTS } from "./save-state.ts";
import { SaveDetails, SaveStatus } from "./save-status.tsx";
import type { EditorSessions, OpenedSession, OpenFailure } from "./sessions.ts";
import type { LinkTarget } from "./link-picker/link-picker.ts";
import type { ReadingWidthStore } from "./reading-width.ts";
import type { VersionSource } from "./versions/source.ts";
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
  /** 이 탭이 보이는 판. 정보 패널의 버전 탭이 그 행에 표시를 단다. */
  readonly version?: string;
}

/** 문서 탭이 쓰는 통로. 창마다 entry가 만들어 넘긴다. */
export interface EditorDeps {
  readonly source: EditorSource;
  readonly readingWidth: ReadingWidthStore;
  readonly menu: MenuOpener;
  /** 파일 통로와 창의 편집 session. 없으면 고친 글은 이 화면의 초안으로만 남는다. */
  readonly files?: EditorSessions;
  /** 버전 이력·비교·복원 통로(shell#T18). 없으면 비교를 열지 않는다. */
  readonly versions?: VersionSource;
  /**
   * main의 core 통로. core 끊김(desktop#R7)에서 저장 gate를 닫고 확인 시각을 보이려고
   * 연결 상태를 여기서 읽는다. 없으면(통로 없는 테스트) 끊김 줄을 두지 않는다.
   */
  readonly core?: CoreSource;
}

/** 문서 탭 본문 자리에 여는 버전 비교. */
export interface CompareTarget {
  readonly before: string;
  readonly after: string;
}

export interface DocumentViewProps extends EditorDeps {
  documentId: string;
  projectId: string;
  infoOpen?: boolean;
  onToggleInfo?: () => void;
  /** 바깥에서 넘기는 형식 검사 문제. 저장 흐름의 검사 결과와 함께 보인다. */
  problems?: readonly EditorProblem[];
  onMeta?: (meta: DocumentTabMeta) => void;
  /** 이 탭이 보이는 판과 읽기·편집. 현재 보기 힌트만 쓰고 탭 제목에는 쓰지 않는다. */
  onPresentation?: (
    presentation: { editing: boolean; version: string },
  ) => void;
  /** 문서 링크를 따라 다른 문서를 연다. */
  onOpenDocument?: (document: string) => void;
  /** 열린 버전 비교. null이면 문서를 읽거나 고친다. */
  compare?: CompareTarget | null;
  onCompare?: (target: CompareTarget | null) => void;
  /** 복원으로 판이 바뀌었다. 정보 패널이 다시 읽는다. */
  onVersionsChanged?: () => void;
  now?: () => number;
}

type InfoState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly info: DocumentInfo };

type Notice = "width-failed" | "menu-unavailable" | null;

/** 충돌 해결 화면. theirs는 지금 디스크 글이나 최신 판 글이다. */
type Resolving =
  | {
    readonly against: "disk";
    readonly theirs: string;
    readonly hash: string | null;
  }
  | {
    readonly against: "newest";
    readonly theirs: string;
    readonly latest: string;
  };

const EDIT_FAILURE: Record<OpenFailure, NoticeKind> = {
  offline: "edit-offline",
  too_large: "edit-too-large",
  unsupported: "edit-unsupported",
  not_found: "edit-unavailable",
  unavailable: "edit-unavailable",
};

/** files.watch가 실패하면 이만큼 쉬고 다시 묻는다. */
const WATCH_RETRY_MS = 5000;

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
    files,
    onMeta,
    onPresentation,
    onOpenDocument,
    versions,
    compare = null,
    onCompare,
    onVersionsChanged,
    now = Date.now,
    core,
  }: DocumentViewProps,
) {
  // core 끊김(desktop#R7). 통로가 있으면 연결 상태를 따르고 저장 gate를 닫는다.
  const connection = useConnectionSafe(core);
  const [state, setState] = useState<InfoState>({ kind: "loading" });
  const [body, setBody] = useState<BodyState>({ kind: "loading" });
  const [sections, setSections] = useState<readonly OutlineSection[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [links, setLinks] = useState<readonly LinkTarget[]>([]);
  const [sticky, setSticky] = useState<StickyHead>(HIDDEN_STICKY);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);
  // 저장 흐름. 편집을 처음 시작할 때 연다. 창의 session 묶음이 탭이 사라진 뒤에도 남긴다.
  const [opened, setOpened] = useState<OpenedSession | null>(null);
  const [facts, setFacts] = useState<SaveFacts | null>(null);
  const [editFailure, setEditFailure] = useState<NoticeKind | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resolving, setResolving] = useState<Resolving | null>(null);
  const [reloadShown, setReloadShown] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);
  const mounted = useRef(true);
  const [width, setWidth] = useReadingWidth(readingWidth);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const latest = useRef({ onMeta, onPresentation });
  latest.current = { onMeta, onPresentation };

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    setBody({ kind: "loading" });
    setSections([]);
    setDraft(null);
    setEditing(false);
    setOpened(null);
    setFacts(null);
    setResolving(null);
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
        version: info.version,
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
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 저장 사실을 듣는다. 화면이 사라지면 편집을 끝내고(탭 전환·닫기) 남은 저장은 창이 센다.
  useEffect(() => {
    if (!opened || !files) return;
    setFacts(opened.session.facts);
    const stop = opened.session.subscribe(setFacts);
    return () => {
      stop();
      files.detach(documentId);
    };
  }, [opened, files, documentId]);

  // documents가 알린 지금 파일 상태. 판 확정(유휴 종료 포함)과 바깥 변경을 여기서만 안다.
  useEffect(() => {
    if (!opened || !files) return;
    let live = true;
    let cursor: string | undefined;
    let wait: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      while (live) {
        const reply = await files.watch(documentId, cursor);
        if (!live) return;
        if (!reply.ok) {
          if (reply.code === "unknown_session") return;
          await new Promise((resolve) => {
            wait = setTimeout(resolve, WATCH_RETRY_MS);
          });
          continue;
        }
        cursor = reply.value.cursor;
        if (opened.session.applyStatus(reply.value) !== "reload") continue;
        const current = await files.current(documentId);
        if (!live || !current.ok) continue;
        // 고침이 없을 때만 받는다. 그 사이 고쳤으면 다음 쓰기가 충돌을 알린다.
        if (opened.session.applyStatus(reply.value) !== "reload") continue;
        opened.session.reloaded(current.value.text, current.value.hash);
        editorRef.current?.replaceText(current.value.text);
        setDraft(current.value.text);
        setReloadShown(true);
      }
    })();
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [opened, files, documentId]);

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
  // 파일 통로가 있으면 편집 글은 main이 연 지금 디스크 글이라 판 본문 읽기를 기다리지 않는다.
  // 통로가 없으면 끝까지 읽은 판 본문만 고친다(일부만 고치면 나머지를 잃는다).
  const canEdit = files
    ? state.kind === "ready" && body.kind !== "loading"
    : body.kind === "text" && body.complete;
  const info = state.kind === "ready" ? state.info : null;

  const toggleEdit = useCallback(() => {
    if (!canEdit) return;
    if (editing) {
      // 읽기 전환은 편집 종료다. 마지막 고침을 보내고 version 준비 경계를 연다(R1).
      setEditing(false);
      setResolving(null);
      void opened?.session.flush(true);
      return;
    }
    if (!files || opened) {
      setEditing(true);
      return;
    }
    setEditFailure(null);
    void files.attach(documentId, info?.fileName ?? documentId).then(
      (result) => {
        if (typeof result === "string") {
          if (mounted.current) setEditFailure(EDIT_FAILURE[result]);
          return;
        }
        if (!mounted.current) {
          files.detach(documentId);
          return;
        }
        setOpened(result);
        setDraft(result.session.text);
        setEditing(true);
      },
    );
  }, [canEdit, editing, files, opened, documentId, info]);

  const onDraft = useCallback((next: string) => {
    setDraft(next);
    // core가 끊겼으면 새 쓰기를 보내지 않는다. 초안은 이 화면에 남고 연결이 돌아오면 쓴다(desktop#R7).
    if (connection.state !== "ready") return;
    opened?.session.edit(next);
  }, [opened, connection]);

  const openCompare = async (against: "disk" | "newest") => {
    if (!opened || !files) return;
    setCompareFailed(false);
    if (against === "disk") {
      const current = await files.current(documentId);
      if (!current.ok) {
        setCompareFailed(true);
        return;
      }
      setResolving({
        against: "disk",
        theirs: current.value.text,
        hash: current.value.hash,
      });
      return;
    }
    const latest = opened.session.facts.version.latest;
    if (latest === null) return;
    const read = await source.body(documentId, latest, () => {});
    if (read.kind !== "text" || !read.complete) {
      setCompareFailed(true);
      return;
    }
    setResolving({ against: "newest", theirs: read.text, latest });
  };

  const keepMine = () => {
    if (!opened || !resolving) return;
    setResolving(null);
    if (resolving.against === "disk") {
      void opened.session.keepMine(resolving.hash);
    } else void opened.session.keepMineAsVersion(resolving.latest);
  };

  const useTheirs = () => {
    if (!opened || !resolving) return;
    setResolving(null);
    setDraft(resolving.theirs);
    if (resolving.against === "disk") {
      opened.session.takeTheirs(resolving.theirs, resolving.hash);
    } else {
      opened.session.edit(resolving.theirs);
      void opened.session.keepMineAsVersion(resolving.latest);
    }
  };

  const saveProblems: readonly EditorProblem[] = facts && opened
    ? editorProblems(facts.format.problems, opened.primaryPath ?? "")
    : [];
  const shownProblems = saveProblems.length > 0
    ? [...problems, ...saveProblems]
    : problems;

  const onSaveAction = (action: Exclude<SaveAction, null>) => {
    if (!opened) return;
    if (action === "retry") opened.session.retry();
    else if (action === "check") void opened.session.check();
    else if (action === "compare") {
      void openCompare(
        opened.session.facts.disk.state === "conflict" ? "disk" : "newest",
      );
    } else {
      const first = shownProblems.find((problem) => problem.line !== null);
      if (first && first.line !== null) {
        if (!editing) setEditing(true);
        editorRef.current?.revealLine(first.line);
      }
    }
  };

  useEffect(() => {
    if (state.kind !== "ready") return;
    latest.current.onPresentation?.({
      editing,
      version: state.info.version,
    });
  }, [editing, state]);

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
    if (top !== undefined) {
      scroller.scrollTop = Math.max(0, top - STICKY_HEIGHT);
    }
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
    if (!mod || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "e") {
      event.preventDefault();
      event.stopPropagation();
      toggleEdit();
    } else if (key === "s") {
      // 명시 저장. 저장 버튼은 없고 이 키는 편집 종료와 같은 경계다(R1).
      event.preventDefault();
      event.stopPropagation();
      void opened?.session.flush(true);
    }
  };

  // 복원 전에 이 탭의 마지막 고침을 보내 편집을 끝낸다. 저장이 끝나지 않으면 복원하지 않는다.
  const restoreVersion = async (
    version: string,
    base: string,
  ): Promise<RestoreAnswer> => {
    if (!versions) return { kind: "failed", code: "unavailable" };
    if (opened && !(await opened.session.flush(true))) {
      return { kind: "unsaved" };
    }
    const result = await versions.restore(documentId, version, base);
    return result.ok
      ? { kind: "report", report: result.value }
      : { kind: "failed", code: result.code };
  };

  if (compare && versions && onCompare) {
    return (
      <div className={styles.compare} data-document-view="compare">
        <CompareView
          document={documentId}
          before={compare.before}
          after={compare.after}
          source={versions}
          onChange={(before, after) => onCompare({ before, after })}
          onClose={() => onCompare(null)}
          onRestore={restoreVersion}
          onRestored={() => {
            setAttempt((value) => value + 1);
            onVersionsChanged?.();
          }}
        />
      </div>
    );
  }

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

  const versionMeta = info
    ? t("document.label.meta", {
      number: info.versionNumber,
      when: formatRelativeTime(new Date(info.savedAt), new Date(now())),
    })
    : "";
  // core가 끊겼으면 저장 불가·초안 유지를 메타 줄에서 함께 보인다(desktop#R7, editor#R12).
  const saving = (facts !== null && saveHeadline(facts).kind !== "none") ||
    connection.state === "stale";
  const meta = saving && facts
    ? (
      <SaveStatus
        facts={facts}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((value) => !value)}
        onAction={onSaveAction}
        connection={connection}
      />
    )
    : connection.state === "stale"
    ? (
      <SaveStatus
        facts={INITIAL_FACTS}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((value) => !value)}
        onAction={onSaveAction}
        connection={connection}
      />
    )
    : versionMeta;
  const notices: NoticeKind[] = [
    ...(facts ? saveNotices(facts) : []),
    ...(compareFailed ? ["compare-failed" as const] : []),
    ...(editFailure ? [editFailure] : []),
    ...(notice ? [notice] : []),
    ...(reloadShown ? ["reloaded" as const] : []),
  ];
  const shownNotice = resolving ? null : topNotice(notices);

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
              {saving && facts && detailsOpen
                ? <SaveDetails facts={facts} now={now()} />
                : null}
              {shownNotice
                ? (
                  <NoticeBar
                    kind={shownNotice}
                    onCompare={() =>
                      void openCompare(
                        shownNotice === "conflict" ? "disk" : "newest",
                      )}
                    onDismiss={() => setReloadShown(false)}
                  />
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
              activeId={(sections.find((section) =>
                section.title === sticky.section
              ) ?? sections[0])?.key}
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
              : resolving && opened
              ? (
                <ConflictView
                  against={resolving.against}
                  theirs={resolving.theirs}
                  mine={opened.session.text}
                  onKeepMine={keepMine}
                  onUseTheirs={useTheirs}
                  onBack={() => setResolving(null)}
                />
              )
              : editing
              ? (
                <MarkdownEditor
                  ref={editorRef}
                  initialText={text}
                  label={info?.title ?? ""}
                  problems={shownProblems}
                  linkTargets={links}
                  onChange={onDraft}
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
