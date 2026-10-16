// 문서 탭. 탭 key는 파일 경로이고 확장자로 viewer를 고른다(md, text, 이미지, pdf). 본문이 탭 바로 아래부터 시작하고
// 조작은 탭 안 맨 위의 view bar에 있다. Info는 그 칸 오른쪽에 붙어 본문 위로 뜬다(Info · Contexts, Outline은 Info 안).
// 틀·view bar·정보 panel·편집기·viewer는 모두 renderer 편집기(`packages/shell/renderer/editor`)의 component이고,
// 이 파일은 고정 data(`editor/fake-source.ts`)와 gallery의 열기·상태 props를 이어 준다.
import { useEffect, useRef, useState } from "react";
import {
  type ReadingWidthSetting,
  useReadingWidth,
} from "@lophn/design/components";

import { DocumentContexts } from "../../../../packages/shell/renderer/workspace/contexts/document-contexts.tsx";
import { createFakeContextsSource } from "../../../../packages/shell/renderer/workspace/contexts/fake-source.ts";
import { FileFrame } from "../../../../packages/shell/renderer/editor/file-frame.tsx";
import {
  factsOf,
  fakeTextOf,
} from "../../../../packages/shell/renderer/editor/fake-source.ts";
import type { MarkdownEditorHandle } from "../../../../packages/shell/renderer/editor/markdown-editor.tsx";
import { MarkdownPane } from "../../../../packages/shell/renderer/editor/markdown-pane.tsx";
import {
  fileKindOf as editorKindOf,
  outlineOf,
} from "../../../../packages/shell/renderer/editor/model.ts";
import { revealInReading } from "../../../../packages/shell/renderer/editor/reveal.ts";
import { fileKindOf } from "./project-files/file-data.ts";
import type { FileInit, SaveState } from "./project-files/file-data.ts";
import { isOutside, metaOf } from "./project-files/file-data.ts";
import {
  ConflictCompare,
  ConflictToast,
  ReloadedToast,
} from "./project-files/notices.tsx";
import {
  ImageViewer,
  PdfViewer,
  TextEditor,
} from "./project-files/viewers.tsx";
import { contextOf, contextTab } from "./phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";

type Open = (tab: TabSpec) => void;

/** Info 칸의 탭. Info와 Contexts 둘이다. */
export type InfoPanel = "info" | "contexts";

// gallery는 읽기 폭을 기본으로 고정한다.
const READING_WIDTH: ReadingWidthSetting = {
  read: () => "default",
  write: () => {},
  subscribe: () => () => {},
};

/** 본문 stand-in 글. md는 편집기가 같은 글을 읽고 고친다. */
const textOf = (path: string) => fakeTextOf(path) ?? "";

/**
 * 문서 칸 본문. 확장자로 viewer를 고른다. `info`가 있으면 오른쪽에 info panel이 본문 위로 떠서 열린다(본문 폭은 그대로).
 * 다른 칸은 덮지 않는다. `file`은 이 탭의 시작 상태(저장 상태, 밖에서 바뀐 알림, 열린 줄)다.
 */
export function DocumentPane(
  { path, open, info, editing, onEditing, file }: {
    path: string;
    open: Open;
    info: InfoPanel | null;
    onInfo?: (panel: InfoPanel) => void;
    onToggleInfo?: () => void;
    editing: boolean;
    onEditing: () => void;
    file?: FileInit;
  },
) {
  const kind = fileKindOf(path);
  const text = textOf(path);
  const facts = factsOf(
    path,
    kind === "markdown" || kind === "text" ? text : undefined,
  );
  const outline = kind === "markdown" ? outlineOf(text) : null;
  const [status, setStatus] = useState<SaveState>(file?.status ?? "saved");
  const [reloaded, setReloaded] = useState(file?.reloaded ?? false);
  const [comparing, setComparing] = useState(file?.compare ?? false);
  const [width] = useReadingWidth(READING_WIDTH);
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const editor = useRef<MarkdownEditorHandle>(null);
  const [current, setCurrent] = useState(outline?.[0]?.key);
  const [source] = useState(() => createFakeContextsSource());
  // 검색 결과로 열린 줄이 있으면 그 줄로 간다.
  useEffect(() => {
    if (file?.line === undefined || kind !== "markdown") return;
    if (editing) editor.current?.revealLine(file.line);
    else if (article.current && scroller.current) {
      revealInReading(article.current, scroller.current, text, file.line);
    }
  }, [file?.line]);
  const conflict = status === "conflict";
  const resolve = () => {
    setStatus("saved");
    setComparing(false);
  };
  const toasts = conflict
    ? (
      <ConflictToast
        comparing={comparing}
        onCompare={() => setComparing(!comparing)}
        onKeepMine={resolve}
        onUseDisk={resolve}
      />
    )
    : reloaded
    ? <ReloadedToast onDismiss={() => setReloaded(false)} />
    : null;
  const contextName = contextOf(path);
  return (
    <FileFrame
      path={path}
      kind={editorKindOf(path)}
      outside={isOutside(path)}
      meta={metaOf(path)}
      line={file?.line}
      state={kind === "image" || kind === "pdf" ? null : status}
      editing={editing}
      onEditing={onEditing}
      info={{
        size: facts.size,
        modifiedAt: facts.modifiedAt,
        outline,
        currentKey: current,
        onJump: (section) => {
          setCurrent(section.key);
          const heading = [...article.current?.querySelectorAll("h1, h2") ?? []]
            .find((element) => element.textContent?.trim() === section.title);
          heading?.scrollIntoView({ block: "start", behavior: "smooth" });
        },
        contexts: (
          <DocumentContexts
            source={source}
            project="prj"
            path={path}
            onOpenContext={() =>
              contextName === null ? undefined : open(contextTab(contextName))}
          />
        ),
      }}
      initialInfo={info ?? undefined}
      onDelete={() => Promise.resolve(true)}
      toasts={toasts}
    >
      {conflict && comparing
        ? <ConflictCompare />
        : kind === "markdown"
        ? (
          <MarkdownPane
            text={text}
            label={path}
            editing={editing}
            width={width}
            scrollRef={scroller}
            articleRef={article}
            editorRef={editor}
          />
        )
        : kind === "text"
        ? <TextEditor path={path} line={file?.line} />
        : kind === "image"
        ? <ImageViewer path={path} />
        : <PdfViewer path={path} />}
    </FileFrame>
  );
}
