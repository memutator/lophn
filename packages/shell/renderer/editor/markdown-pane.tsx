// md 본문 칸. live preview 편집기가 scroll 칸과 읽기 기둥 안에 놓인다.
import { type Ref, type RefObject, useMemo } from "react";
import { ReadingFrame, type ReadingWidth } from "@lophn/ui/layout";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.tsx";
import { windowLinkOpener } from "../desktop/settings/core-call.ts";
import { windowEditorFiles, type EditorFiles } from "./source.ts";
import { useDocumentImages } from "./use-file.ts";
import styles from "./markdown-pane.module.css";

interface MarkdownPaneProps {
  /** 이 문서의 절대 경로. 상대 경로 그림을 그 문서 옆 file에서 읽는다. */
  path: string;
  /** 문서 옆 file을 읽는 통로. 없으면 이 창의 bridge를 쓴다. */
  files?: EditorFiles;
  text: string;
  /** 편집기의 접근 이름. */
  label: string;
  width: ReadingWidth;
  scrollRef?: Ref<HTMLDivElement>;
  editorRef?: RefObject<MarkdownEditorHandle | null>;
  onChange?: (text: string) => void;
  onScroll?: () => void;
  onPasteImage?: (images: readonly File[]) => Promise<readonly string[]>;
}

export function MarkdownPane({
  path,
  files,
  text,
  label,
  width,
  scrollRef,
  editorRef,
  onChange,
  onScroll,
  onPasteImage,
}: MarkdownPaneProps) {
  // gallery처럼 `lophnShell`이 없는 곳에서는 undefined이고, link를 넘기지 않는다.
  const openLink = windowLinkOpener();
  const editorFiles = useMemo(() => files ?? windowEditorFiles(), [files]);
  const resolveImage = useDocumentImages(editorFiles, path);
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
            onPasteImage={onPasteImage}
            resolveImage={resolveImage}
            onOpenLink={
              openLink === undefined ? undefined : (href) => void openLink(href)
            }
          />
        </div>
      </ReadingFrame>
    </div>
  );
}
