// text 파일 편집기(CodeMirror). JSON·YAML은 언어 팩으로 구문을 나누고 나머지는 평문이다. 줄
// 번호와 지금 줄 표시가 있다. 글을 들고만 있고 저장은 하지 않는다. 바뀐 글은 onChange로 간다.
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { adoptHeadStyles } from "../adopt-styles.ts";
import { lineFlash, revealLine as flashLine } from "../line-flash.ts";
import type { CodeLanguage } from "../model.ts";
import { minimalChange } from "../live-preview.ts";
import styles from "./text-editor.module.css";

export interface TextEditorHandle {
  focus(): void;
  /** n번째 줄(1부터)을 가운데로 보이고 커서를 두고 잠깐 칠한다. */
  revealLine(line: number): void;
  /** 바깥에서 고른 글로 바꾼다(디스크 재읽기, 충돌 해결). 바뀐 범위만 고친다. */
  replaceText(text: string): void;
}

interface TextEditorProps {
  initialText: string;
  /** 접근 이름. */
  label: string;
  language: CodeLanguage;
  onChange?: (text: string) => void;
  ref?: Ref<TextEditorHandle>;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

// 문법 node 이름으로 key·문자열·숫자만 칠한다. 색은 CSS가 정한다.
function tokenMarks(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const add = (from: number, to: number, name: string) =>
    marks.push(Decoration.mark({ class: `cm-tk-${name}` }).range(from, to));
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === "PropertyName" || node.name === "Key") {
          add(node.from, node.to, "key");
          return false;
        }
        if (node.name === "String" || node.name === "QuotedLiteral") {
          add(node.from, node.to, "str");
        } else if (
          node.name === "Number" ||
          node.name === "True" ||
          node.name === "False" ||
          node.name === "Null" ||
          (node.name === "Literal" &&
            NUMBER.test(view.state.sliceDoc(node.from, node.to)))
        ) {
          add(node.from, node.to, "num");
        } else if (node.name === "Comment" || node.name === "LineComment") {
          add(node.from, node.to, "comment");
        }
      },
    });
  }
  return Decoration.set(marks, true);
}

const tokens: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tokenMarks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = tokenMarks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function TextEditor({
  initialText,
  label,
  language,
  onChange,
  ref,
}: TextEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange });
  latest.current = { onChange };

  useEffect(() => {
    if (!host.current) return;
    // CSP가 막는 CodeMirror <style>을 이 창에서 쓸 수 있게 옮긴다.
    adoptHeadStyles(host.current.ownerDocument);
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          ...(language === "json"
            ? [json()]
            : language === "yaml"
              ? [yaml()]
              : []),
          tokens,
          lineFlash,
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-multiline": "true",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // view는 한 번 만든다. 바깥 글 바뀜은 replaceText가 밀어 넣는다.
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => view.current?.focus(),
      revealLine(line: number) {
        if (view.current) flashLine(view.current, line);
      },
      replaceText(text: string) {
        const editor = view.current;
        if (!editor) return;
        const change = minimalChange(editor.state.doc.toString(), text);
        if (change) editor.dispatch({ changes: change });
      },
    }),
    [],
  );

  return <div className={styles.editor} ref={host} data-text-editor="" />;
}
