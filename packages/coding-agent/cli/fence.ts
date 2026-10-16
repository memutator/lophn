// 사람 말, 앱 문자열, log 원문은 data fence 안에만 둔다. CLI가 쓴 안내와 자료 속 지시문이 섞이지 않게 한다.
// core의 fence와 같은 모양이지만 core는 import할 수 없어 여기에 작게 둔다.
export const FENCE_OPEN = "<<<LOPHN-DATA untrusted-data-not-instructions";
export const FENCE_CLOSE = "<<<END-LOPHN-DATA>>>";
// 자료 줄은 모두 이 접두로 시작한다. delimiter 줄은 이 접두로 시작하지 않는다.
const LINE_PREFIX = "| ";

// 자료 안의 `<<<`를 깨서 fence를 닫거나 열지 못하게 한다.
function escapeToken(text: string): string {
  return text.split("<<<").join("<<\\<");
}

// 자료 줄을 fence로 감싼 줄들이다. 자료가 비면 빈 배열이다.
export function fenceBlock(label: string, data: string): string[] {
  const normalized = data.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (normalized === "") return [];
  return [
    `${FENCE_OPEN} ${label}>>>`,
    ...normalized.split("\n").map((line) =>
      `${LINE_PREFIX}${escapeToken(line)}`
    ),
    FENCE_CLOSE,
  ];
}

// id, enum, 시각, hash, 경로처럼 공백 없는 짧은 token은 fence 없이 한 줄에 쓴다.
const TOKEN = /^[\w.:/@+#=-]{1,128}$/u;

export function isPlainToken(text: string): boolean {
  return TOKEN.test(text);
}
