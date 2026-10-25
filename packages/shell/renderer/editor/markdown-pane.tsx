// md 본문 칸. 읽기와 live preview 편집이 같은 scroll 칸·기둥·배경을 쓰고 본문 자리만 바뀐다.
import type { Ref, RefObject } from "react";
import { ReadingFrame, type ReadingWidth } from "@lophn/ui/layout";
import { Markdown } from "@lophn/ui/reading";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.tsx";
import { windowLinkOpener } from "../desktop/settings/core-call.ts";
import styles from "./markdown-pane.module.css";

interface MarkdownPaneProps {
  text: string;
  /** 편집기의 접근 이름. */
  label: string;
  editing: boolean;
  width: ReadingWidth;
  scrollRef?: Ref<HTMLDivElement>;
  articleRef?: Ref<HTMLDivElement>;
  editorRef?: RefObject<MarkdownEditorHandle | null>;
  onChange?: (text: string) => void;
  onScroll?: () => void;
}

export function MarkdownPane(
  {
    text,
    label,
    editing,
    width,
    scrollRef,
    articleRef,
    editorRef,
    onChange,
    onScroll,
  }: MarkdownPaneProps,
) {
  // gallery처럼 `lophnShell`이 없는 곳에서는 undefined이고, link를 넘기지 않는다.
  const openLink = windowLinkOpener();
  return (
    <div
      ref={scrollRef}
      className={styles.main}
      data-reading-width={width}
      onScroll={onScroll}
    >
      <ReadingFrame width={width}>
        <div ref={articleRef} className={styles.article} data-document-body="">
          {editing
            ? (
              <MarkdownEditor
                ref={editorRef}
                initialText={text}
                label={label}
                onChange={onChange}
              />
            )
            : (
              <Markdown
                source={text}
                onOpenLink={openLink === undefined
                  ? undefined
                  : (href) => void openLink(href)}
              />
            )}
        </div>
      </ReadingFrame>
    </div>
  );
}
