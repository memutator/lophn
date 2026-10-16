import { err, ok, type Result } from "../../../base/mod.ts";

// 훑기 규칙. 순수 판정만 둔다. 파일을 읽고 걷는 일은 work.ts가 한다.

// 이보다 큰 파일은 건너뛴다.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
// snippet(text)의 최대 길이.
const SNIPPET_MAX = 200;
// NUL이 있는지 보는 앞부분의 크기.
const NUL_PROBE_BYTES = 8 * 1024;

type LineMatch = {
  line: number;
  text: string;
  start: number;
  end: number;
};

export function pageLimit(limit: number | undefined): number {
  return Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
}

export function isSkippedName(name: string): boolean {
  return name === ".git";
}

// 디렉터리는 뒤에 `/`를 붙여 비교한다. 이 순서로 걸으면 파일이 전체 경로의 code unit 순으로 나온다.
export function sortKey(name: string, isDirectory: boolean): string {
  return isDirectory ? `${name}/` : name;
}

// 앞 8KB에 NUL이 없고 UTF-8로 읽히는 파일만 text다. 아니면 null이다.
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, NUL_PROBE_BYTES).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function normalizeQuery(query: string): string {
  return query.normalize("NFC").toLowerCase();
}

// 줄마다 처음 일치 하나를 낸다. needle은 normalizeQuery를 거친 값이다.
// 소문자로 바꾸면 길이가 달라지는 글자(İ 같은)는 위치가 조금 어긋날 수 있다.
export function searchText(text: string, needle: string): LineMatch[] {
  const found: LineMatch[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.replace(/\r$/, "").normalize("NFC");
    const at = line.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    found.push({ line: index + 1, ...snippetOf(line, at, at + needle.length) });
  }
  return found;
}

// 일치 위치가 가운데 오도록 앞뒤를 잘라 200자 안쪽으로 맞춘다. start·end는 snippet 안의 위치다.
function snippetOf(
  line: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  if (line.length <= SNIPPET_MAX) return { text: line, start, end };
  const pad = Math.max(0, Math.floor((SNIPPET_MAX - (end - start)) / 2));
  const to = Math.min(line.length, Math.max(0, start - pad) + SNIPPET_MAX);
  const from = Math.max(0, to - SNIPPET_MAX);
  return {
    text: line.slice(from, to),
    start: start - from,
    end: Math.min(end, to) - from,
  };
}

// 다음 페이지가 이어 훑을 위치. 마지막으로 낸 일치다.
export type Cursor = { folder: number; path: string; line: number };

export function encodeCursor(cursor: Cursor): string {
  return encodeURIComponent(
    JSON.stringify([cursor.folder, cursor.path, cursor.line]),
  );
}

export function decodeCursor(text: string): Result<Cursor> {
  try {
    const value = JSON.parse(decodeURIComponent(text));
    if (
      Array.isArray(value) && value.length === 3 &&
      Number.isInteger(value[0]) && value[0] >= 0 &&
      typeof value[1] === "string" &&
      Number.isInteger(value[2]) && value[2] >= 1
    ) {
      return ok({ folder: value[0], path: value[1], line: value[2] });
    }
  } catch {
    // 아래 오류로 모은다.
  }
  return err({ code: "invalid_input", message: "invalid cursor" });
}
