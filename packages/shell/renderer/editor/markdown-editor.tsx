// Markdown 편집기. CodeMirror 6은 이 폴더에만 있고 SDK에 공개하지
// 않는다. 글을 들고만 있고 저장은 하지 않는다. 바꾼 글은 onChange로 호출자에게 간다.
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  defaultResolveImage,
  livePreview,
  minimalChange,
} from "./live-preview.ts";
import { adoptHeadStyles } from "./adopt-styles.ts";
import { lineFlash, revealLine as flashLine } from "./line-flash.ts";
import { FindBar } from "./find/find-bar.tsx";
import { useEditorFind } from "./find/use-editor-find.ts";
import styles from "./markdown-editor.module.css";

export interface MarkdownEditorHandle {
  focus(): void;
  /** 찾기 줄을 연다. replace면 바꾸기 줄도 연다. */
  openFind(replace?: boolean): void;
  /** n번째 줄(1부터)을 가운데로 보이고 커서를 두고 잠깐 칠한다. */
  revealLine(line: number): void;
  /** n번째 줄 위 끝의 화면 y(px). 아직 그리지 않은 줄도 높이 추정으로 준다. */
  lineTop(line: number): number | null;
  /** 바깥에서 고른 글로 바꾼다(디스크 재읽기, 충돌 해결). 바뀐 범위만 고친다. */
  replaceText(text: string): void;
}

interface MarkdownEditorProps {
  /** 처음 글. 뒤의 바깥 바꿈은 이 편집기의 몫이 아니다. */
  initialText: string;
  /** 접근 이름. */
  label: string;
  onChange?: (text: string) => void;
  /** Mod+클릭한 링크 href. 없으면 링크는 열리지 않는다. */
  onOpenLink?: (href: string) => void;
  ref?: Ref<MarkdownEditorHandle>;
}

export function MarkdownEditor({
  initialText,
  label,
  onChange,
  onOpenLink,
  ref,
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onOpenLink });
  latest.current = { onChange, onOpenLink };
  const find = useEditorFind(view);
  const { onDocChanged } = find;

  useEffect(() => {
    if (!host.current) return;
    // CSP가 막는 CodeMirror <style>을 이 창에서 쓸 수 있게 옮긴다.
    adoptHeadStyles(host.current.ownerDocument);
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          livePreview({
            resolveImage: defaultResolveImage,
          }),
          lineFlash,
          EditorView.domEventHandlers({
            click(event) {
              if (!(event.metaKey || event.ctrlKey)) return false;
              const link = (event.target as HTMLElement).closest("[data-href]");
              const href = link?.getAttribute("data-href");
              if (!href || !latest.current.onOpenLink) return false;
              latest.current.onOpenLink(href);
              return true;
            },
          }),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-multiline": "true",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onDocChanged();
            latest.current.onChange?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // view는 한 번 만든다. 뒤에 바뀌는 props는 아래 effect가 밀어 넣는다.
  }, []);

  const revealLine = useCallback((line: number) => {
    if (view.current) flashLine(view.current, line);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => view.current?.focus(),
      openFind: (replace = false) => find.openFind(replace),
      revealLine,
      lineTop(line: number) {
        const editor = view.current;
        if (!editor || line < 1 || line > editor.state.doc.lines) return null;
        const block = editor.lineBlockAt(editor.state.doc.line(line).from);
        return editor.documentTop + block.top;
      },
      replaceText(text: string) {
        const editor = view.current;
        if (!editor) return;
        const change = minimalChange(editor.state.doc.toString(), text);
        if (change) editor.dispatch({ changes: change });
      },
    }),
    [revealLine, find.openFind],
  );

  return (
    <div
      className={styles.editor}
      onKeyDownCapture={find.onKeyDown}
      data-markdown-editor=""
    >
      {find.open ? <FindBar {...find.bar} /> : null}
      <div className={styles.area}>
        <div className={styles.host} ref={host} />
      </div>
    </div>
  );
}
