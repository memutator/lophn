// NFC, 소문자, 글자·숫자가 아닌 것은 공백 한 칸으로 줄인다.
export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const isAscii = (s: string) => /^\p{ASCII}*$/u.test(s);

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

// 줄 단위 multiset 차이. 고친 줄은 새 줄이라 더해진 줄에 든다.
export function addedLines(before: string, after: string): string[] {
  const left = new Map<string, number>();
  for (const l of lines(before)) left.set(l, (left.get(l) ?? 0) + 1);
  return lines(after).filter((l) => {
    const n = left.get(l) ?? 0;
    if (n === 0) return true;
    left.set(l, n - 1);
    return false;
  });
}
