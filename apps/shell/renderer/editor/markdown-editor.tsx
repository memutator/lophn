// Markdown 편집기(shell/editor#R7, R9–R11). CodeMirror 6은 이 폴더에만 있고 SDK에 공개하지
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
  linkTrigger,
  livePreview,
  minimalChange,
  setFindMatches,
} from "./live-preview.ts";
import { setProblems } from "./problems-gutter/gutter.ts";
import type { EditorProblem } from "./problems-gutter/problems.ts";
import { ProblemList } from "./problems-gutter/problem-list.tsx";
import {
  findLabel,
  findMatches,
  nearestMatch,
  replaceAll,
  stepMatch,
} from "./find/find.ts";
import { FindBar } from "./find/find-bar.tsx";
import {
  type LinkTarget,
  linkRows,
  linkText,
  rowAt,
  type Trigger,
} from "./link-picker/link-picker.ts";
import { LinkPicker } from "./link-picker/link-picker.tsx";
import styles from "./markdown-editor.module.css";

export interface MarkdownEditorHandle {
  focus(): void;
  /** n번째 줄(1부터)을 가운데로 보이고 커서를 둔다. */
  revealLine(line: number): void;
  /** n번째 줄 위 끝의 화면 y(px). 아직 그리지 않은 줄도 높이 추정으로 준다. */
  lineTop(line: number): number | null;
}

export interface MarkdownEditorProps {
  /** 처음 글. 뒤의 바깥 바꿈은 이 편집기의 몫이 아니다. */
  initialText: string;
  /** 접근 이름. */
  label: string;
  problems?: readonly EditorProblem[];
  /** `[[`가 보일 문서. */
  linkTargets?: readonly LinkTarget[];
  onChange?: (text: string) => void;
  /** Mod-click한 링크. */
  onOpenLink?: (href: string) => void;
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
    problems = [],
    linkTargets = [],
    onChange,
    onOpenLink,
    ref,
  }: MarkdownEditorProps,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onOpenLink });
  latest.current = { onChange, onOpenLink };
  const [find, setFind] = useState<FindState>({ open: false, replace: false });
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(-1);
  // 찾기 줄이 열린 동안 글이 바뀌면 일치를 다시 센다.
  const [revision, setRevision] = useState(0);
  const findOpen = useRef(false);
  findOpen.current = find.open;
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [linkIndex, setLinkIndex] = useState(0);

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          livePreview({
            onOpenLink: (href) => latest.current.onOpenLink?.(href),
            resolveImage: defaultResolveImage,
          }),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-multiline": "true",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) {
              setTrigger(linkTrigger(update.state));
            }
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

  useEffect(() => {
    view.current?.dispatch({ effects: setProblems.of(problems) });
  }, [problems]);

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

  const rows = useMemo(
    () => trigger ? linkRows(linkTargets, trigger.query) : [],
    [trigger?.from, trigger?.query, linkTargets],
  );
  useEffect(() => setLinkIndex(0), [trigger?.query]);

  const pick = useCallback((row: LinkTarget) => {
    const editor = view.current;
    if (!editor || !trigger) return;
    const text = linkText(row);
    editor.dispatch({
      changes: { from: trigger.from, to: trigger.to, insert: text },
      selection: EditorSelection.cursor(trigger.from + text.length),
      userEvent: "input.complete",
    });
    setTrigger(null);
    editor.focus();
  }, [trigger]);

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
  }), [revealLine]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 링크 고르기가 열려 있으면 이동 key는 목록 몫이다. Escape도 목록을 먼저 닫는다.
    if (trigger && rows.length > 0) {
      const row = rowAt(rows, linkIndex);
      const handled = event.key === "ArrowDown"
        ? (setLinkIndex((index) => index + 1), true)
        : event.key === "ArrowUp"
        ? (setLinkIndex((index) => index - 1), true)
        : event.key === "Enter" && row
        ? (pick(row), true)
        : event.key === "Escape"
        ? (setTrigger(null), true)
        : false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
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

  const picker = (() => {
    const editor = view.current;
    if (!editor || !trigger) return null;
    const coords = editor.coordsAtPos(trigger.from);
    const box = host.current?.getBoundingClientRect();
    // 자리를 재지 못해도 키보드로 고르는 목록은 숨기지 않고 편집 칸 왼쪽 위에 둔다.
    if (!coords || !box) return { top: 0, left: 0 };
    return { top: coords.bottom - box.top, left: coords.left - box.left };
  })();

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
        {trigger && picker
          ? (
            <LinkPicker
              rows={rows}
              active={rows.length > 0
                ? ((linkIndex % rows.length) + rows.length) % rows.length
                : 0}
              top={picker.top}
              left={picker.left}
              onPick={pick}
              onClose={() => setTrigger(null)}
            />
          )
          : null}
      </div>
      {problems.length > 0
        ? (
          <ProblemList
            problems={problems}
            onSelect={revealLine}
          />
        )
        : null}
    </div>
  );
}
