// 글 파일 탭(md와 그 밖의 text). md는 live preview 편집기이고, 그 밖의 text는
// CodeMirror 편집기다. 글은 창의 편집 session이 들고, 고침은 저장 버튼 없이 저장 흐름으로 간다.
// 밖에서 바뀐 파일과 충돌은 탭 위쪽 toast로 알린다.
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReadingWidth } from "@lophn/ui/layout";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import type { FileFailure } from "../../ipc/files.ts";
import { useSettingsChanged } from "../desktop/connection/events/hooks.tsx";
import { ConflictCompare } from "./conflict/conflict-compare.tsx";
import type { DocumentViewProps } from "./document-view.tsx";
import { FileFrame, FileStatus } from "./file-frame.tsx";
import { folderOf, pastedImageName } from "./image-paste.ts";
import type { MarkdownEditorHandle } from "./markdown-editor.tsx";
import { MarkdownPane } from "./markdown-pane.tsx";
import { fileKindOf, languageOf, outlineOf, sectionKeyOf } from "./model.ts";
import { fileNameOf } from "./model.ts";
import { ConflictToast, NoticeToast, ReloadedToast } from "./notices.tsx";
import type { ReplaceCause, SaveSession, SaveState } from "./save-state.ts";
import { useTextFile } from "./use-file.ts";
import { ReadOnlyText } from "./viewers/read-only-text.tsx";
import { TextEditor, type TextEditorHandle } from "./viewers/text-editor.tsx";

type EditorHandle = TextEditorHandle & Pick<MarkdownEditorHandle, "lineTop">;

/** 열지 못한 이유. */
export function failureText(code: FileFailure): string | null {
  switch (code) {
    case "not_found":
      return t("document.error.not-found");
    case "unsupported":
      return t("document.error.text-unsupported");
    case "forbidden":
      return t("document.error.forbidden");
    default:
      return null;
  }
}

export function TextFileView(props: DocumentViewProps) {
  const { path, sessions } = props;
  const [attempt, setAttempt] = useState(0);
  const file = useTextFile(sessions, path, attempt);
  useEffect(() => {
    props.onMeta?.({
      fileName: fileNameOf(path),
      title: fileNameOf(path),
      path,
    });
  }, [path]);

  if (file.kind === "loading") {
    // 탭을 오갈 때마다 다시 읽으므로 짧은 읽기에는 아무것도 그리지 않는다(다른 읽기 화면과 같은 300ms 규칙).
    return (
      <FileStatus>
        <Loading loading placeholder={<Skeleton shape="line" lines={6} />}>
          {null}
        </Loading>
      </FileStatus>
    );
  }
  if (file.kind === "failed") {
    const message = failureText(file.code);
    return (
      <FileStatus>
        {message === null ? (
          <ErrorState
            target={t("document.label.this-document")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : (
          <p role="status">{message}</p>
        )}
      </FileStatus>
    );
  }
  if (file.kind === "too_large") {
    return (
      <FileStatus>
        <p role="status">{t("document.notice.too-large")}</p>
        {file.text === null ? null : (
          <ReadOnlyText text={file.text} label={fileNameOf(path)} />
        )}
      </FileStatus>
    );
  }
  return (
    <ReadyTextFile {...props} session={file.session} initial={file.initial} />
  );
}

const HEAD_OFFSET = 8;

function ReadyTextFile({
  path,
  sessions,
  readingWidth,
  outside = false,
  line,
  lineNonce,
  onDelete,
  initialInfo,
  initialPosition,
  onReadPosition,
  now,
  session,
  initial,
}: DocumentViewProps & { session: SaveSession; initial: string }) {
  const kind = fileKindOf(path) === "markdown" ? "markdown" : "text";
  const name = fileNameOf(path);
  const [text, setText] = useState(initial);
  const [state, setState] = useState<SaveState>(session.facts.state);
  const [reloaded, setReloaded] = useState(false);
  const [conflictShown, setConflictShown] = useState(true);
  const [comparing, setComparing] = useState<string | null>(null);
  const [compareFailed, setCompareFailed] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | undefined>();
  const [width] = useReadingWidth(readingWidth);
  const editorRef = useRef<EditorHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreTarget = useRef(initialPosition?.scroll_offset ?? 0);
  // 복원 scroll이 잡히기 전의 0은 저장 위치를 지우지 않는다.
  const restoreHold = useRef(restoreTarget.current > 0);
  const onPosition = useRef(onReadPosition);
  onPosition.current = onReadPosition;

  useEffect(() => {
    void readingWidth.load();
  }, [readingWidth]);
  // 읽기 폭은 이 문서 밖(Settings 화면, `lophn settings set`)에서도 바뀐다.
  useSettingsChanged(() => void readingWidth.load());

  useEffect(() => {
    setState(session.facts.state);
    const stopFacts = session.subscribe((facts) => {
      setState(facts.state);
      if (facts.state === "conflict") setConflictShown(true);
      else setComparing(null);
    });
    const stopReplace = session.onReplace((next, cause: ReplaceCause) => {
      setText(next);
      editorRef.current?.replaceText(next);
      if (cause === "external") setReloaded(true);
    });
    return () => {
      stopFacts();
      stopReplace();
    };
  }, [session]);

  // 목차는 화면이 가진 본문에서 만든다. 편집 중에도 갱신하되 입력을 막지 않게 미룬다.
  const deferred = useDeferredValue(text);
  const sections = useMemo(
    () => (kind === "markdown" ? outlineOf(deferred) : null),
    [deferred, kind],
  );
  const size = useMemo(
    () => new TextEncoder().encode(deferred).byteLength,
    [deferred],
  );

  // 저장 위치를 본문이 놓인 뒤에 다시 적용한다. 높이가 생기기 전에는 scrollTop이 0으로 붙는다.
  useEffect(() => {
    const target = restoreTarget.current;
    if (!(target > 0) || kind !== "markdown") return;
    let tries = 0;
    let stuckFor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const scroller = scrollRef.current;
      tries += 1;
      if (scroller) scroller.scrollTop = target;
      if (scroller !== null && scroller.scrollTop > 0) stuckFor += 1;
      else stuckFor = 0;
      if (stuckFor >= 3 || tries >= 40) {
        timer = setTimeout(() => {
          restoreHold.current = false;
        }, 400);
        return;
      }
      timer = setTimeout(tick, 50);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [kind, path]);

  // 검색 결과로 열면 그 줄로 간다.
  useEffect(() => {
    if (line !== undefined) editorRef.current?.revealLine(line);
  }, [line, lineNonce]);

  const headingTops = useCallback((): number[] => {
    const scroller = scrollRef.current;
    if (!scroller || !sections) return [];
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    return sections.map(
      (section) => (editorRef.current?.lineTop?.(section.line) ?? 0) - base,
    );
  }, [sections]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller || !sections) return;
    const tops = headingTops();
    let current = -1;
    for (let index = 0; index < tops.length; index += 1) {
      if (tops[index]! <= scroller.scrollTop + HEAD_OFFSET) current = index;
      else break;
    }
    const section = sections[current] ?? sections[0];
    setCurrentKey((previous) =>
      previous === section?.key ? previous : section?.key,
    );
    const offset = scroller.scrollTop;
    if (!onPosition.current || (offset === 0 && restoreHold.current)) return;
    onPosition.current({
      section: sectionKeyOf(sections, section?.line ?? 1),
      scroll_offset: offset,
    });
  };

  const jump = (target: { key: string; line: number }) => {
    editorRef.current?.revealLine(target.line);
  };

  const openCompare = async () => {
    if (comparing !== null) {
      setComparing(null);
      return;
    }
    const disk = await session.readDisk();
    if (disk.ok) setComparing(disk.value.text);
    else setCompareFailed(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (
      key === "f" ||
      (event.altKey && event.code === "KeyF") ||
      (key === "h" && !event.altKey)
    ) {
      // 편집기 밖(탭 틀, view bar)에 focus가 있어도 찾기가 열린다.
      event.preventDefault();
      event.stopPropagation();
      editorRef.current?.openFind(event.altKey || key === "h");
    } else if (key === "s" && !event.altKey) {
      // 저장 버튼은 없다. 이 키는 지금 쓰는 것이다.
      event.preventDefault();
      event.stopPropagation();
      void session.flush();
    }
  };

  const toasts: ReactNode =
    state === "conflict" && conflictShown ? (
      <ConflictToast
        comparing={comparing !== null}
        onCompare={() => void openCompare()}
        onUseDisk={() => void session.takeTheirs()}
        onKeepMine={() => void session.keepMine()}
        onClose={() => setConflictShown(false)}
      />
    ) : compareFailed ? (
      <NoticeToast
        title={t("document.error.compare-failed")}
        onClose={() => setCompareFailed(false)}
      />
    ) : reloaded ? (
      <ReloadedToast onClose={() => setReloaded(false)} />
    ) : null;

  const onChange = (next: string) => {
    setText(next);
    session.edit(next);
  };

  // 붙여넣은 그림은 이 문서 옆에 file로 쓰고, 문서에는 상대 경로 링크를 넣는다. 폴더의 지금
  // 목록을 모르므로 이름이 겹치면(conflict) `image 2.png`처럼 두 번 더 시도한다.
  const pasteImage = useCallback(
    async (images: readonly File[]): Promise<readonly string[]> => {
      const folder = folderOf(path);
      const links: string[] = [];
      for (const image of images) {
        const bytes = new Uint8Array(await image.arrayBuffer());
        const taken: string[] = [];
        for (let tries = 0; tries < 3; tries += 1) {
          const name = pastedImageName(image, taken);
          if (name === null) break;
          taken.push(name);
          const reply = await sessions.files.writeBytes({
            path: `${folder}/${name}`,
            bytes,
          });
          if (reply.ok) {
            links.push(`![](./${name})`);
            break;
          }
          if (reply.code !== "conflict") break;
        }
      }
      return links;
    },
    [path, sessions],
  );

  let body: ReactNode;
  if (comparing !== null) {
    body = <ConflictCompare disk={comparing} mine={session.text} />;
  } else if (kind === "markdown") {
    body = (
      <MarkdownPane
        path={path}
        files={sessions.files}
        text={text}
        label={name}
        width={width}
        scrollRef={scrollRef}
        editorRef={editorRef}
        onChange={onChange}
        onScroll={onScroll}
        onPasteImage={pasteImage}
      />
    );
  } else {
    body = (
      <TextEditor
        ref={editorRef}
        initialText={text}
        label={name}
        language={languageOf(path)}
        onChange={onChange}
      />
    );
  }

  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1];
  return (
    <FileFrame
      path={path}
      kind={kind}
      outside={outside}
      meta={kind === "text" ? (extension ?? "text").toUpperCase() : null}
      line={line}
      state={state}
      onConflict={() => setConflictShown(true)}
      onRetry={() => void session.retry()}
      info={{
        size,
        outline: sections,
        currentKey: currentKey ?? sections?.[0]?.key,
        onJump: jump,
        now,
      }}
      initialInfo={initialInfo}
      onDelete={onDelete}
      toasts={toasts}
      onKeyDownCapture={onKeyDown}
    >
      {body}
    </FileFrame>
  );
}
