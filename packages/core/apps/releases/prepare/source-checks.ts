// release 준비가 앱 source(commit에 든 .tsx/.jsx/.ts/.js)에서 보는, 빌드(esbuild)가 못 잡는 실수 둘.
// 1. 소문자 JSX 요소의 `title=` 속성: 브라우저 기본 tooltip이 뜬다. `Tooltip`(`@lophn/ui/overlay`)을 쓴다. 폰 화면은 보지 않는다.
// 2. `useTabHead`의 `actions` 항목에서 목록에 없는 `icon` 이름: shell이 조용히 버린다.
// JS parser가 없어서(typescript 7은 JS AST API가 없다) 가볍게 훑는다. 놓치는 쪽은 괜찮고 잘못 잡는 쪽은 release를 막으므로
// 모양이 분명하지 않으면 그냥 넘어간다.
import { TAB_HEAD_ICONS } from "../../../../protocol/shell/app-bridge-types.ts";

type SourceFile = { path: string; bytes: Uint8Array };

const MAX_REPORTED = 20;

function isAppSource(path: string): boolean {
  return (
    /\.[jt]sx?$/.test(path) &&
    !path.startsWith(".lophn/sdk/") &&
    !path.split("/").includes("node_modules")
  );
}

// 주석을 같은 길이의 공백으로 바꿔 줄 번호를 지킨다. 줄 앞의 `//`와 `/* */`만 본다
// (JSX 글자와 "http://"를 주석으로 오인하지 않으려고 줄 뒤의 `//`는 두지 않는다).
function blankComments(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return text
    .replace(/^[ \t]*\/\/.*$/gm, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank);
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// text[i]가 따옴표나 backtick이면 문자열 끝 다음 위치를, 아니면 null을 준다.
// '·" 문자열은 한 줄 안에서만 닫힌다(JSX 글자의 아포스트로피를 문자열로 읽지 않으려고).
function skipString(text: string, i: number): number | null {
  const quote = text[i];
  if (quote === "`") {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === "\\") j++;
      else if (text[j] === "`") return j + 1;
      else if (text[j] === "$" && text[j + 1] === "{") {
        const end = skipBraces(text, j + 1);
        if (end === null) return null;
        j = end - 1;
      }
    }
    return null;
  }
  if (quote !== '"' && quote !== "'") return null;
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === quote) return j + 1;
    else if (text[j] === "\n") return null;
  }
  return null;
}

// text[i]는 `{`. 짝이 맞는 `}` 다음 위치를 준다. 못 찾으면 null.
function skipBraces(text: string, i: number): number | null {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const str = skipString(text, j);
    if (str !== null) {
      j = str - 1;
      continue;
    }
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return j + 1;
  }
  return null;
}

// 여는 tag 하나의 속성 이름과 위치. JSX로 읽히지 않으면(`a<b` 같은 비교, 제네릭) null.
function tagAttributes(
  text: string,
  start: number,
): { name: string; index: number }[] | null {
  const attrs: { name: string; index: number }[] = [];
  const name = /[A-Za-z_][\w:.-]*/y;
  let i = start;
  for (;;) {
    while (/\s/.test(text[i] ?? "")) i++;
    const c = text[i];
    if (c === ">") return attrs;
    if (c === "/" && text[i + 1] === ">") return attrs;
    if (c === "{") {
      const end = skipBraces(text, i);
      if (end === null) return null;
      i = end;
      continue;
    }
    name.lastIndex = i;
    const found = name.exec(text);
    if (found === null) return null;
    attrs.push({ name: found[0], index: i });
    i += found[0].length;
    while (/\s/.test(text[i] ?? "")) i++;
    if (text[i] !== "=") continue;
    i++;
    while (/\s/.test(text[i] ?? "")) i++;
    if (text[i] === "{") {
      const end = skipBraces(text, i);
      if (end === null) return null;
      i = end;
    } else {
      const end = skipString(text, i);
      if (end === null) return null;
      i = end;
    }
  }
}

function titleAttributes(path: string, text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/<([a-z][A-Za-z0-9]*)(?=[\s/>])/g)) {
    // iframe의 title은 접근성 필수다. 대문자 component의 title은 prop이다.
    if (match[1] === "iframe") continue;
    const attrs = tagAttributes(text, match.index + match[0].length);
    const title = attrs?.find((attr) => attr.name === "title");
    if (title === undefined) continue;
    found.push(
      `${path}:${lineOf(text, title.index)}: <${match[1]}> has a title attribute, which shows the browser's own tooltip. Use Tooltip from @lophn/ui/overlay instead.`,
    );
  }
  return found;
}

// `actions: [` 배열 안, 배열 바로 아래 object의 `icon: "literal"`.
function tabHeadIcons(path: string, text: string): string[] {
  // `useTabHead`를 쓰고 app-ui를 가져오는 파일만 본다. 앱이 다른 뜻으로 쓰는 `actions`·`icon`을 건드리지 않으려는 것이다.
  if (!/from\s*["']@lophn\/app-ui["']/.test(text)) return [];
  if (!/\buseTabHead\b/.test(text)) return [];
  const found: string[] = [];
  const literal = /icon\s*:\s*(["'])([^"'\n\\]*)\1/y;
  for (const match of text.matchAll(/\bactions\s*:\s*\[/g)) {
    const stack: string[] = [];
    for (let i = match.index + match[0].length - 1; i < text.length; i++) {
      const str = skipString(text, i);
      if (str !== null) {
        i = str - 1;
        continue;
      }
      const c = text[i];
      if (c === "[" || c === "{" || c === "(") stack.push(c);
      else if (c === "]" || c === "}" || c === ")") {
        stack.pop();
        if (stack.length === 0) break;
      } else if (c === "i" && stack.length === 2 && stack[1] === "{") {
        if (/[\w$.]/.test(text[i - 1] ?? "")) continue;
        literal.lastIndex = i;
        const icon = literal.exec(text);
        if (icon === null) continue;
        const name = icon[2];
        if (!(TAB_HEAD_ICONS as readonly string[]).includes(name)) {
          found.push(
            `${path}:${lineOf(text, i)}: the tab-head action icon "${name}" is not a lophn icon name, so lophn drops it. Use one of: ${TAB_HEAD_ICONS.join(", ")}.`,
          );
        }
      }
    }
  }
  return found;
}

// 문제 없으면 null, 있으면 agent가 읽고 고칠 글.
export function checkAppSource(files: readonly SourceFile[]): string | null {
  const found: string[] = [];
  const decoder = new TextDecoder();
  // 폰 화면(`src/screens/<key>/phone.tsx`)의 dir은 React Native라 browser tooltip이 없다. tab-head 검사는
  // `@lophn/app-ui`를 가져오는 file만 보는데 폰 화면 build가 그 import를 막으므로 따로 뺄 것이 없다.
  const phoneDirs = files
    .filter((file) => /^src\/screens\/[^/]+\/phone\.tsx$/.test(file.path))
    .map((file) => file.path.slice(0, -"phone.tsx".length));
  for (const file of files) {
    if (!isAppSource(file.path)) continue;
    const text = blankComments(decoder.decode(file.bytes));
    if (
      /\.[jt]sx$/.test(file.path) &&
      !phoneDirs.some((dir) => file.path.startsWith(dir))
    )
      found.push(...titleAttributes(file.path, text));
    found.push(...tabHeadIcons(file.path, text));
  }
  if (found.length === 0) return null;
  const shown = found.slice(0, MAX_REPORTED);
  const more = found.length - shown.length;
  return `The committed source has problems release cannot ship:\n${shown.join("\n")}${more > 0 ? `\n...and ${more} more.` : ""}`;
}
