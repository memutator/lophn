// Markdown 편집기. CodeMirror 6은 이 폴더에만 있고 SDK에 공개하지
// 않는다. 글을 들고만 있고 저장은 하지 않는다. 바꾼 글은 onChange로 호출자에게 간다.
import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  defaultResolveImage,
  livePreview,
  minimalChange,
  setFindMatches,
} from "./live-preview.ts";
import { adoptHeadStyles } from "./adopt-styles.ts";
import {
  findLabel,
  findMatches,
  nearestMatch,
  replaceAll,
  stepMatch,
} from "./find/find.ts";
import { FindBar } from "./find/find-bar.tsx";
import styles from "./markdown-editor.module.css";

export interface MarkdownEditorHandle {
  focus(): void;
  /** n번째 줄(1부터)을 가운데로 보이고 커서를 둔다. */
  revealLine(line: number): void;
  /** n번째 줄 위 끝의 화면 y(px). 아직 그리지 않은 줄도 높이 추정으로 준다. */
  lineTop(line: number): number | null;
  /** 바깥에서 고른 글로 바꾼다(디스크 재읽기, 충돌 해결). 바뀐 범위만 고친다. */
  replaceText(text: string): void;
}

export interface MarkdownEditorProps {
  /** 처음 글. 뒤의 바깥 바꿈은 이 편집기의 몫이 아니다. */
  initialText: string;
  /** 접근 이름. */
  label: string;
  onChange?: (text: string) => void;
  ref?: Ref<MarkdownEditorHandle>;
}

interface FindState {
  readonly open: boolean;
  readonly replace: boolean;
}

export function MarkdownEditor(
  {
    initialText,
    label,
    onChange,
    ref,
  }: MarkdownEditorProps,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange });
  latest.current = { onChange };
  const [find, setFind] = useState<FindState>({ open: false, replace: false });
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(-1);
  // 찾기 줄이 열린 동안 글이 바뀌면 일치를 다시 센다.
  const [revision, setRevision] = useState(0);
  const findOpen = useRef(false);
  findOpen.current = find.open;

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
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-multiline": "true",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (findOpen.current) setRevision((value) => value + 1);
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

  const matches = useMemo(() => {
    if (!find.open || !view.current) return [];
    return findMatches(view.current.state.doc.toString(), query, {
      caseSensitive,
    });
    // revision이 글을 대신한다.
  }, [find.open, query, caseSensitive, revision]);

  // query가 바뀌면 커서 뒤 첫 일치부터 센다. 고칠 때마다 다시 고르지 않는다.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    setCurrent(nearestMatch(matches, editor.state.selection.main.from));
  }, [query, caseSensitive, find.open]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const index = current < matches.length
      ? current
      : matches.length > 0
      ? 0
      : -1;
    const match = index >= 0 ? matches[index] : undefined;
    editor.dispatch({
      effects: [
        setFindMatches.of({
          matches: find.open ? matches : [],
          current: index,
        }),
        ...(match
          ? [EditorView.scrollIntoView(match.from, { y: "center" })]
          : []),
      ],
    });
  }, [matches, current, find.open]);

  const step = useCallback((direction: 1 | -1) => {
    const next = stepMatch(current, matches.length, direction);
    setCurrent(next);
    const match = matches[next];
    if (view.current && match) {
      view.current.dispatch({
        selection: EditorSelection.single(match.from, match.to),
      });
    }
  }, [current, matches]);

  const closeFind = useCallback(() => {
    setFind({ open: false, replace: false });
    view.current?.focus();
  }, []);

  const openFind = useCallback((replace: boolean) => {
    const editor = view.current;
    const selected = editor
      ? editor.state.sliceDoc(
        editor.state.selection.main.from,
        editor.state.selection.main.to,
      )
      : "";
    if (selected && !selected.includes("\n")) setQuery(selected);
    setFind({ open: true, replace });
  }, []);

  const replaceOne = useCallback((replacement: string) => {
    const editor = view.current;
    const match = matches[current];
    if (!editor || !match) return;
    editor.dispatch({
      changes: { from: match.from, to: match.to, insert: replacement },
      selection: EditorSelection.cursor(match.from + replacement.length),
      userEvent: "input.replace",
    });
  }, [matches, current]);

  const replaceEvery = useCallback((replacement: string) => {
    const editor = view.current;
    if (!editor || matches.length === 0) return;
    const text = editor.state.doc.toString();
    const change = minimalChange(
      text,
      replaceAll(text, matches, replacement).text,
    );
    if (change) {
      editor.dispatch({ changes: change, userEvent: "input.replace.all" });
    }
  }, [matches]);

  const revealLine = useCallback((line: number) => {
    const editor = view.current;
    if (!editor) return;
    const target = editor.state.doc.line(
      Math.min(Math.max(1, line), editor.state.doc.lines),
    );
    editor.dispatch({
      selection: EditorSelection.cursor(target.from),
      effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    });
    editor.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
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
  }), [revealLine]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (mod && event.altKey && (key === "f" || event.code === "KeyF")) {
      openFind(true);
    } else if (mod && !event.altKey && key === "f") openFind(false);
    else if (event.key === "Escape" && find.open) closeFind();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div
      className={styles.editor}
      onKeyDownCapture={onKeyDown}
      data-markdown-editor=""
    >
      {find.open
        ? (
          <FindBar
            query={query}
            onQuery={setQuery}
            caseSensitive={caseSensitive}
            onCaseSensitive={setCaseSensitive}
            label={findLabel(current, matches.length)}
            hasMatches={matches.length > 0}
            onNext={() => step(1)}
            onPrevious={() => step(-1)}
            onClose={closeFind}
            replace={find.replace}
            onReplace={replaceOne}
            onReplaceAll={replaceEvery}
          />
        )
        : null}
      <div className={styles.area}>
        <div className={styles.host} ref={host} />
      </div>
    </div>
  );
}
