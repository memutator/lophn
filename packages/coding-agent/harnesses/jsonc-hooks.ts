// JSONC 설정(Devin `config.json`)의 `hooks`에 우리 항목을 넣는다. 주석, 쉼표, 들여쓰기와 우리 항목 밖의 byte는 그대로
// 둬야 해서 다시 직렬화하지 않고 바꿀 위치(offset)만 찾아 그 자리의 글자만 고친다.
// 파싱되지 않거나 모양이 틀리면 null이다(쓰지 않고 `failed`).
import type { HarnessId } from "../../protocol/coding-agent/mod.ts";
import { isObject, sameJson } from "./install-common.ts";
import { ownedEntry } from "./json-hooks.ts";

type Node =
  | { kind: "object"; start: number; end: number; members: Member[] }
  | { kind: "array"; start: number; end: number; items: Node[] }
  | { kind: "scalar"; start: number; end: number; value: unknown };
type Member = { key: string; keyAt: number; value: Node };

function parseJsonc(text: string): Node {
  let at = 0;
  const skip = () => {
    for (;;) {
      while (/\s/.test(text[at] ?? "")) at++;
      if (text.startsWith("//", at)) {
        while (at < text.length && text[at] !== "\n") at++;
      } else if (text.startsWith("/*", at)) {
        const close = text.indexOf("*/", at + 2);
        if (close === -1) throw new Error("unterminated comment");
        at = close + 2;
      } else return;
    }
  };
  const string = (): string => {
    const start = at++;
    while (text[at] !== '"') {
      if (at >= text.length) throw new Error("unterminated string");
      at += text[at] === "\\" ? 2 : 1;
    }
    at++;
    return JSON.parse(text.slice(start, at));
  };
  const value = (): Node => {
    skip();
    const start = at;
    const char = text[at];
    if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      const members: Member[] = [];
      const items: Node[] = [];
      at++;
      for (;;) {
        skip();
        if (text[at] === close) break;
        if (char === "{") {
          if (text[at] !== '"') throw new Error("key expected");
          const keyAt = at;
          const key = string();
          skip();
          if (text[at++] !== ":") throw new Error(": expected");
          members.push({ key, keyAt, value: value() });
        } else items.push(value());
        skip();
        if (text[at] === ",") at++;
        else if (text[at] !== close) throw new Error(", expected");
      }
      at++;
      return char === "{"
        ? { kind: "object", start, end: at, members }
        : { kind: "array", start, end: at, items };
    }
    if (char === '"') {
      return { kind: "scalar", start, end: at, value: string() };
    }
    const word = /-?\d[\d.eE+-]*|true|false|null/y;
    word.lastIndex = at;
    const found = word.exec(text);
    if (found === null) throw new Error("value expected");
    at += found[0].length;
    return { kind: "scalar", start, end: at, value: JSON.parse(found[0]) };
  };
  const root = value();
  skip();
  if (at !== text.length) throw new Error("trailing text");
  return root;
}

function valueOf(node: Node): unknown {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return node.items.map(valueOf);
  return Object.fromEntries(
    node.members.map((member) => [member.key, valueOf(member.value)]),
  );
}

type Edit = { start: number; end: number; text: string };

// 줄 맨 앞 공백이다.
function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return text.slice(lineStart).match(/^[ \t]*/)![0];
}

// 객체·배열 끝에 항목들(이미 직렬화한 글)을 붙이는 edit이다. 여러 줄이면 첫 항목의 들여쓰기를 따른다.
function appendTo(
  text: string,
  node: Extract<Node, { kind: "object" | "array" }>,
  unit: string,
  render: (indent: string) => string[],
): Edit {
  const first = node.kind === "object" ? node.members[0]?.value : node.items[0];
  const last = node.kind === "object"
    ? node.members.at(-1)?.value
    : node.items.at(-1);
  const multiline = text.slice(node.start, node.end).includes("\n");
  if (!multiline) {
    const inner = render("").map((one) => one.replace(/\n\s*/g, " ")).join(
      ", ",
    );
    return last === undefined
      ? { start: node.start + 1, end: node.end - 1, text: inner }
      : { start: last.end, end: last.end, text: `, ${inner}` };
  }
  const indent = first === undefined
    ? lineIndent(text, node.start) + unit
    // 첫 항목이 줄 맨 앞에 있을 때만 그 줄의 들여쓰기를 쓴다. 객체의 member는 key가 줄 앞이다.
    : lineIndent(
      text,
      node.kind === "object" ? node.members[0].keyAt : first.start,
    );
  const body = render(indent).map((one) => `${indent}${one}`).join(",\n");
  return last === undefined
    ? {
      start: node.start + 1,
      end: node.end - 1,
      text: `\n${body}\n${lineIndent(text, node.start)}`,
    }
    : { start: last.end, end: last.end, text: `,\n${body}` };
}

function pretty(value: unknown, indent: string, unit: string): string {
  return JSON.stringify(value, null, unit).replace(/\n/g, `\n${indent}`);
}

// `hooks`의 event마다 우리 항목(Claude 꼴)을 놓는다. 이미 같으면 text 그대로를 돌려준다.
export function jsoncHooksText(
  text: string | null,
  input: {
    harness: HarnessId;
    events: readonly string[];
    ours: (event: string) => unknown;
  },
): string | null {
  const { harness, events, ours } = input;
  if (text === null) {
    const hooks = Object.fromEntries(events.map((e) => [e, [ours(e)]]));
    return `${JSON.stringify({ hooks }, null, 2)}\n`;
  }
  let root: Node;
  try {
    root = parseJsonc(text);
  } catch {
    return null;
  }
  if (root.kind !== "object") return null;
  const unit = root.members[0] === undefined
    ? "  "
    : lineIndent(text, root.members[0].keyAt) || "  ";
  const edits: Edit[] = [];
  const hooksMember = root.members.find((member) => member.key === "hooks");
  if (hooksMember === undefined) {
    edits.push(appendTo(text, root, unit, (indent) => [
      `"hooks": ${
        pretty(
          Object.fromEntries(events.map((e) => [e, [ours(e)]])),
          indent,
          unit,
        )
      }`,
    ]));
  } else {
    const hooks = hooksMember.value;
    if (hooks.kind !== "object") return null;
    const missing: string[] = [];
    for (const event of events) {
      const member = hooks.members.find((one) => one.key === event);
      if (member === undefined) {
        missing.push(event);
        continue;
      }
      const list = member.value;
      if (list.kind !== "array") return null;
      const owned = list.items.find((item) =>
        ownedEntry(harness, valueOf(item))
      );
      if (owned === undefined) {
        edits.push(appendTo(text, list, unit, (indent) => [
          pretty(ours(event), indent, unit),
        ]));
      } else if (!sameJson(valueOf(owned), ours(event))) {
        edits.push({
          start: owned.start,
          end: owned.end,
          text: pretty(ours(event), lineIndent(text, owned.start), unit),
        });
      }
    }
    if (missing.length > 0) {
      edits.push(
        appendTo(
          text,
          hooks,
          unit,
          (indent) =>
            missing.map((event) =>
              `${JSON.stringify(event)}: ${pretty([ours(event)], indent, unit)}`
            ),
        ),
      );
    }
  }
  if (edits.length === 0) return text;
  let next = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  try {
    const done = valueOf(parseJsonc(next));
    if (!isObject(done) || !isObject(done.hooks)) return null;
  } catch {
    return null;
  }
  return next;
}
