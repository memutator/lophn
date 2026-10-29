// markdown과 text 편집기가 같이 쓰는 찾기·바꾸기 상태와 동작. CodeMirror view는 편집기가 만들고 여기는 ref로 받는다.
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { minimalChange } from "../live-preview.ts";
import type { FindBarProps } from "./find-bar.tsx";
import {
  findLabel,
  findMatches,
  nearestMatch,
  replaceAll,
  setFindMatches,
  stepMatch,
} from "./find.ts";

interface FindState {
  readonly open: boolean;
  readonly replace: boolean;
}

export function useEditorFind(viewRef: RefObject<EditorView | null>) {
  const [find, setFind] = useState<FindState>({ open: false, replace: false });
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(-1);
  // 찾기 줄이 열린 동안 글이 바뀌면 일치를 다시 센다.
  const [revision, setRevision] = useState(0);
  const findOpen = useRef(false);
  findOpen.current = find.open;

  const onDocChanged = useCallback(() => {
    if (findOpen.current) setRevision((value) => value + 1);
  }, []);

  const matches = useMemo(() => {
    const editor = viewRef.current;
    if (!find.open || !editor) return [];
    return findMatches(editor.state.doc.toString(), query, { caseSensitive });
    // revision이 글을 대신한다.
  }, [find.open, query, caseSensitive, revision]);

  // query가 바뀌면 커서 뒤 첫 일치부터 센다. 고칠 때마다 다시 고르지 않는다.
  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    setCurrent(nearestMatch(matches, editor.state.selection.main.from));
  }, [query, caseSensitive, find.open]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    const index =
      current < matches.length ? current : matches.length > 0 ? 0 : -1;
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

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepMatch(current, matches.length, direction);
      setCurrent(next);
      const match = matches[next];
      if (viewRef.current && match) {
        viewRef.current.dispatch({
          selection: EditorSelection.single(match.from, match.to),
        });
      }
    },
    [current, matches],
  );

  const closeFind = useCallback(() => {
    setFind({ open: false, replace: false });
    viewRef.current?.focus();
  }, []);

  const openFind = useCallback((replace: boolean) => {
    const editor = viewRef.current;
    const selected = editor
      ? editor.state.sliceDoc(
          editor.state.selection.main.from,
          editor.state.selection.main.to,
        )
      : "";
    if (selected && !selected.includes("\n")) setQuery(selected);
    setFind({ open: true, replace });
  }, []);

  const replaceOne = useCallback(
    (replacement: string) => {
      const editor = viewRef.current;
      const match = matches[current];
      if (!editor || !match) return;
      editor.dispatch({
        changes: { from: match.from, to: match.to, insert: replacement },
        selection: EditorSelection.cursor(match.from + replacement.length),
        userEvent: "input.replace",
      });
    },
    [matches, current],
  );

  const replaceEvery = useCallback(
    (replacement: string) => {
      const editor = viewRef.current;
      if (!editor || matches.length === 0) return;
      const text = editor.state.doc.toString();
      const change = minimalChange(
        text,
        replaceAll(text, matches, replacement).text,
      );
      if (change) {
        editor.dispatch({ changes: change, userEvent: "input.replace.all" });
      }
    },
    [matches],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (mod && event.altKey && (key === "f" || event.code === "KeyF")) {
      openFind(true);
    } else if (mod && !event.altKey && key === "f") openFind(false);
    else if (mod && !event.altKey && key === "h") openFind(true);
    else if (event.key === "Escape" && find.open) closeFind();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const bar: FindBarProps = {
    query,
    onQuery: setQuery,
    caseSensitive,
    onCaseSensitive: setCaseSensitive,
    label: findLabel(current, matches.length),
    hasMatches: matches.length > 0,
    onNext: () => step(1),
    onPrevious: () => step(-1),
    onClose: closeFind,
    replace: find.replace,
    onReplace: replaceOne,
    onReplaceAll: replaceEvery,
  };

  return { open: find.open, bar, openFind, onDocChanged, onKeyDown };
}
