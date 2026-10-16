// 편집 key의 CodeMirror state command. 글만 바꾼다. key 연결은 live-preview.ts가 한다.
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/**
 * 선택마다 mark(`**`, `*`, `~~`, `` ` ``)로 감싸고, 이미 감싸였으면 푼다. 빈 선택은
 * 짝 사이에 커서를 둔다.
 */
export function toggleMark(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const change = state.changeByRange((range) => {
      const doc = state.doc;
      const before = doc.sliceString(
        Math.max(0, range.from - mark.length),
        range.from,
      );
      const after = doc.sliceString(
        range.to,
        Math.min(doc.length, range.to + mark.length),
      );
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(
            range.from - mark.length,
            range.to - mark.length,
          ),
        };
      }
      const inner = doc.sliceString(range.from, range.to);
      if (
        !range.empty && inner.length >= mark.length * 2 &&
        inner.startsWith(mark) && inner.endsWith(mark)
      ) {
        return {
          changes: {
            from: range.from,
            to: range.to,
            insert: inner.slice(mark.length, -mark.length),
          },
          range: EditorSelection.range(range.from, range.to - mark.length * 2),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(
          range.from + mark.length,
          range.to + mark.length,
        ),
      };
    });
    dispatch(
      state.update(change, { scrollIntoView: true, userEvent: "input.format" }),
    );
    return true;
  };
}

/** `[선택]()`을 넣고 괄호 안에 커서를 둔다. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const change = state.changeByRange((range) => {
    const insert = `[${state.doc.sliceString(range.from, range.to)}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    };
  });
  dispatch(
    state.update(change, { scrollIntoView: true, userEvent: "input.format" }),
  );
  return true;
};

const HEADING = /^(#{1,6})[ \t]+/;

/** 선택한 줄마다 제목 단계(1~6)로 바꾼다. 0은 보통 글이다. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    for (const number of selectedLines(state)) {
      const line = state.doc.line(number);
      const match = HEADING.exec(line.text);
      changes.push({
        from: line.from,
        to: line.from + (match ? match[0].length : 0),
        insert: level > 0 ? "#".repeat(level) + " " : "",
      });
    }
    dispatch(
      state.update({
        changes,
        scrollIntoView: true,
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

/** 목록 항목 앞부분: 들임, 표지나 번호, 빈칸, task 상자. */
interface ListPrefix {
  readonly indent: string;
  readonly marker: string;
  readonly space: string;
  readonly task: string;
  readonly length: number;
}

const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;

function listPrefix(text: string): ListPrefix | null {
  const match = LIST.exec(text);
  if (!match) return null;
  return {
    indent: match[1]!,
    marker: match[2]!,
    space: match[3]!,
    task: match[4] ?? "",
    length: match[0].length,
  };
}

/** code block 안인지. Markdown 언어가 있어야 안다. */
function inCode(state: EditorState, position: number): boolean {
  for (
    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
      state,
    ).resolveInner(position, -1);
    node;
    node = node.parent
  ) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

/**
 * 목록 안 Enter: 다음 항목에 같은 표지(다음 번호, 빈 task 상자)를 둔다. 빈 항목의
 * Enter는 목록을 끝낸다. 다른 곳은 false라 보통 Enter가 된다.
 */
export const continueList: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (
    state.selection.ranges.length > 1 || !range.empty ||
    inCode(state, range.head)
  ) return false;
  const line = state.doc.lineAt(range.head);
  const prefix = listPrefix(line.text);
  if (!prefix || range.head < line.from + prefix.length) return false;
  if (
    line.text.slice(prefix.length).trim() === "" && range.head === line.to
  ) {
    dispatch(state.update({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: EditorSelection.cursor(line.from),
      userEvent: "input",
    }));
    return true;
  }
  const number = /^(\d+)([.)])$/.exec(prefix.marker);
  const marker = number
    ? `${Number(number[1]) + 1}${number[2]}`
    : prefix.marker;
  const insert = `\n${prefix.indent}${marker}${prefix.space}${
    prefix.task ? "[ ] " : ""
  }`;
  dispatch(state.update({
    changes: { from: range.head, to: range.head, insert },
    selection: EditorSelection.cursor(range.head + insert.length),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};

const INDENT = "  ";

/** Tab: 목록 항목을 한 단계 들이거나 code block 안에 빈칸을 넣는다. 다른 곳은 focus 이동이다. */
export const indentList: StateCommand = ({ state, dispatch }) => {
  if (inCode(state, state.selection.main.head)) {
    dispatch(
      state.update(state.replaceSelection(INDENT), {
        userEvent: "input.indent",
      }),
    );
    return true;
  }
  const lines = listLines(state);
  if (!lines) return false;
  dispatch(state.update({
    changes: lines.map((number) => ({
      from: state.doc.line(number).from,
      insert: INDENT,
    })),
    userEvent: "input.indent",
  }));
  return true;
};

/** Shift-Tab: 목록 항목을 한 단계 내어 쓴다. */
export const outdentList: StateCommand = ({ state, dispatch }) => {
  const lines = listLines(state);
  if (!lines) return false;
  const changes: ChangeSpec[] = [];
  for (const number of lines) {
    const line = state.doc.line(number);
    const lead = /^( {1,2}|\t)/.exec(line.text);
    if (lead) changes.push({ from: line.from, to: line.from + lead[0].length });
  }
  dispatch(state.update({ changes, userEvent: "delete.dedent" }));
  return true;
};

/** 체크박스 click: 커서를 옮기지 않고 `[ ]`와 `[x]`를 바꾼다. task 줄이 아니면 null. */
export function toggleTask(
  state: EditorState,
  lineFrom: number,
): TransactionSpec | null {
  const line = state.doc.lineAt(lineFrom);
  const prefix = listPrefix(line.text);
  if (!prefix || !prefix.task) return null;
  const at = line.from + prefix.indent.length + prefix.marker.length +
    prefix.space.length + 1;
  const checked = state.doc.sliceString(at, at + 1).toLowerCase() === "x";
  return {
    changes: { from: at, to: at + 1, insert: checked ? " " : "x" },
    userEvent: "input",
  };
}

function selectedLines(state: EditorState): number[] {
  const out = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) out.add(number);
  }
  return [...out].sort((a, b) => a - b);
}

function listLines(state: EditorState): number[] | null {
  const lines = selectedLines(state);
  return lines.every((number) => listPrefix(state.doc.line(number).text))
    ? lines
    : null;
}
