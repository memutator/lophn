// md 본문 칸. live preview 편집기가 scroll 칸과 읽기 기둥 안에 놓인다.
import type { Ref, RefObject } from "react";
import { ReadingFrame, type ReadingWidth } from "@lophn/ui/layout";

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
  width: ReadingWidth;
  scrollRef?: Ref<HTMLDivElement>;
  editorRef?: RefObject<MarkdownEditorHandle | null>;
  onChange?: (text: string) => void;
  onScroll?: () => void;
}

export function MarkdownPane({
  text,
  label,
  width,
  scrollRef,
  editorRef,
  onChange,
  onScroll,
}: MarkdownPaneProps) {
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
        <div className={styles.article} data-document-body="">
          <MarkdownEditor
            ref={editorRef}
            initialText={text}
            label={label}
            onChange={onChange}
            onOpenLink={
              openLink === undefined ? undefined : (href) => void openLink(href)
            }
          />
        </div>
      </ReadingFrame>
    </div>
  );
}
