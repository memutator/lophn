// md 본문 칸. 읽기와 live preview 편집이 같은 scroll 칸·기둥·배경을 쓰고 본문 자리만 바뀐다.
import type { Ref, RefObject } from "react";
import { ReadingFrame, type ReadingWidth } from "@lophn/ui/layout";
import { Markdown } from "@lophn/ui/reading";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.tsx";
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
            : <Markdown source={text} />}
        </div>
      </ReadingFrame>
    </div>
  );
}
