// Markdown 편집기. CodeMirror 6은 이 폴더에만 있고 SDK에 공개하지
// 않는다. 글을 들고만 있고 저장은 하지 않는다. 바꾼 글은 onChange로 호출자에게 간다.
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { t } from "@lophn/i18n";

import {
  defaultResolveImage,
  livePreview,
  minimalChange,
  refreshImages,
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
  /** 붙여넣은 이미지를 파일 옆에 저장하고 문서에 넣을 링크(상대 경로)를 돌려준다. 없으면 붙여넣지 않는다. */
  onPasteImage?: (images: readonly File[]) => Promise<readonly string[]>;
  /** 문서 상대 경로를 이 창에서 그릴 수 있는 주소로 바꾼다. 없으면 상대 경로는 그리지 않는다. */
  resolveImage?: (src: string) => string | null;
  ref?: Ref<MarkdownEditorHandle>;
}

export function MarkdownEditor({
  initialText,
  label,
  onChange,
  onOpenLink,
  onPasteImage,
  resolveImage,
  ref,
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onOpenLink, onPasteImage, resolveImage });
  latest.current = { onChange, onOpenLink, onPasteImage, resolveImage };
  const [pasteFailed, setPasteFailed] = useState(false);
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
            resolveImage: (src) =>
              latest.current.resolveImage === undefined
                ? defaultResolveImage(src)
                : latest.current.resolveImage(src),
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
            paste(event, editor) {
              const images = [...(event.clipboardData?.files ?? [])].filter(
                (file) => file.type.startsWith("image/"),
              );
              const pasteImage = latest.current.onPasteImage;
              if (images.length === 0 || pasteImage === undefined) return false;
              // 그림을 든 붙여넣기는 브라우저가 경로 글을 넣지 않게 막고 링크를 기다린다.
              event.preventDefault();
              void pasteImage(images).then((links) => {
                if (!editor.dom.isConnected) return;
                setPasteFailed(links.length < images.length);
                if (links.length === 0) return;
                const { doc } = editor.state;
                const at = editor.state.selection.main.head;
                const line = doc.lineAt(at);
                // 그림 링크는 한 줄이 아니라 자기 문단이어야 한다. 앞 그림 바로 뒤에 이어 붙이면
                // 한 줄에 그림이 둘이 되고, 그림 뒤에 커서를 둘 자리(빈 줄)도 없어 입력이 막힌다.
                const lead =
                  line.text.slice(0, at - line.from).trim() !== ""
                    ? "\n\n"
                    : line.number > 1 &&
                        doc.line(line.number - 1).text.trim() !== ""
                      ? "\n"
                      : "";
                const text = `${lead}${links.join("\n\n")}\n\n`;
                editor.dispatch({
                  changes: { from: at, insert: text },
                  selection: { anchor: at + text.length },
                });
                editor.focus();
              });
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

  // resolve한 주소가 뒤늦게 생겼으면(resolveImage가 바뀌었으면) 그림 자리를 다시 만든다.
  useEffect(() => {
    view.current?.dispatch({ effects: refreshImages.of(null) });
  }, [resolveImage]);

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
      {pasteFailed ? (
        <p className={styles.notice} role="status">
          {t("project-workspace.error.explorer-paste-failed")}
        </p>
      ) : null}
    </div>
  );
}
