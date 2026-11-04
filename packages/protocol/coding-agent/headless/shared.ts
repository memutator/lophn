const SUMMARY_MAX = 200;
const SUMMARY_KEYS = [
  "command",
  "file_path",
  "filePath",
  "path",
  "pattern",
  "url",
  "query",
];

// 각 harness parser가 모르는 칸을 던진 채 읽는 출력이라 모양을 고정하지 않는다.
// biome-ignore lint/suspicious/noExplicitAny: 외부 CLI의 JSON을 칸별로 읽는다
export function jsonLine(line: string): Record<string, any> | null {
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

// tool 입력에서 사람이 알아볼 한 줄을 고른다. 이름을 아는 칸이 없으면 첫 글자 값이다.
export function summaryOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const values = input as Record<string, unknown>;
  const key =
    SUMMARY_KEYS.find((k) => typeof values[k] === "string") ??
    Object.keys(values).find((k) => typeof values[k] === "string");
  const text = key === undefined ? "" : (values[key] as string);
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

// 값이 `-`로 시작하는 prompt를 CLI가 flag로 읽지 않게 한다.
export const safePrompt = (prompt: string) =>
  prompt.startsWith("-") ? ` ${prompt}` : prompt;
