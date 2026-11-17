// 편집 tool 입력에서 바뀐 줄을 만든다. DOM이 없어 폰의 diff 화면도 import한다.
import { compareLines } from "../../line-diff.ts";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * tool 입력에서 비교할 앞뒤 글을 꺼낸다. file.edit은 old_string/new_string, file.write는 content 전체다. harness가 싣는
 * 본문은 입력 JSON 글이다. 바꾼 부분만 비교하므로 줄 번호는 바뀐 곳의 처음부터 센다. 읽을 수 없으면 null이다.
 */
export function editDiffOf(
  raw: unknown,
): ReturnType<typeof compareLines> | null {
  const value = typeof raw === "string" ? parseJson(raw) : raw;
  if (value === null || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const after =
    typeof input["new_string"] === "string"
      ? input["new_string"]
      : typeof input["content"] === "string"
        ? input["content"]
        : null;
  if (after === null) return null;
  const before =
    typeof input["old_string"] === "string" ? input["old_string"] : "";
  return compareLines(before, after);
}
