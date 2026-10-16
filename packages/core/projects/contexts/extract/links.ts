// 문서 안 Markdown 링크 `[글](경로)`를 문서 폴더 기준으로 푼다. index kind와 links field가 함께 쓴다.
import { headingsIn, sectionRange } from "./document.ts";
import type { ParsedDocument } from "./types.ts";

type MarkdownLink = {
  text: string;
  // 문서 폴더 기준으로 푼 정규 경로(`./`, `../`, `#조각`, `?query` 정리). Project 밖이면 `../`로 시작한다.
  target: string;
  inside: boolean;
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
// `[글](주소 "제목")`. 주소는 `<...>`이거나 공백 없는 글(괄호 한 겹 허용).
const LINK =
  /(!?)\[((?:[^\][\\]|\\.)*)\]\(\s*(<[^>]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

// 코드 칸(fence 안 줄, inline code)은 같은 길이의 공백으로 가린다.
function maskCode(lines: readonly string[]): string[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const opening = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (
        opening !== undefined && opening[0] === fence[0] &&
        opening.length >= fence.length && line.trim() === opening
      ) {
        fence = null;
      }
      return " ".repeat(line.length);
    }
    if (opening !== undefined) {
      fence = opening;
      return " ".repeat(line.length);
    }
    return line.replace(
      /(`+)([\s\S]*?[^`])\1(?!`)/g,
      (span) => " ".repeat(span.length),
    );
  });
}

function decode(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

// 문서 폴더 기준으로 풀고 `.`·`..`를 정리한다. `/`로 시작하면 Project 루트 기준이다.
function resolve(folder: string, raw: string): string {
  const segments = raw.startsWith("/")
    ? raw.split("/")
    : [...(folder === "" ? [] : folder.split("/")), ...raw.split("/")];
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0 || stack[stack.length - 1] === "..") {
        stack.push("..");
      } else stack.pop();
    } else stack.push(segment);
  }
  return stack.join("/");
}

// 문서 순서. `within`이 있으면 그 제목의 section(하위 포함) 안 링크만.
// 주소 scheme이 있는 링크(https:, mailto:)와 `#`만 있는 링크는 문서 링크가 아니라 뺀다.
export function markdownLinks(
  documentPath: string,
  document: ParsedDocument,
  within?: string,
): MarkdownLink[] {
  const lines = document.body.split("\n");
  let start = 0;
  let end = lines.length;
  if (within !== undefined) {
    const heading = headingsIn(document, { start: 0, end: lines.length })
      .find((candidate) => candidate.title === within);
    if (heading === undefined) return [];
    ({ start, end } = sectionRange(document, heading, true));
  }
  const folder = documentPath.includes("/")
    ? documentPath.slice(0, documentPath.lastIndexOf("/"))
    : "";
  const masked = maskCode(lines);
  const found: MarkdownLink[] = [];
  for (let index = start; index < end; index += 1) {
    for (const match of (masked[index] ?? "").matchAll(LINK)) {
      if (match[1] === "!") continue;
      let address = match[3] ?? "";
      if (address.startsWith("<") && address.endsWith(">")) {
        address = address.slice(1, -1);
      }
      if (SCHEME.test(address) || address.startsWith("//")) continue;
      const path = address.replace(/[#?].*$/s, "");
      if (path === "") continue;
      const target = resolve(folder, decode(path));
      if (target === "") continue;
      found.push({
        text: match[2] ?? "",
        target,
        inside: target !== ".." && !target.startsWith("../"),
      });
    }
  }
  return found;
}
