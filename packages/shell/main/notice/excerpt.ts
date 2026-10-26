const MAX = 160;

/** 알림 본문용 앞부분. 줄바꿈과 공백을 한 칸으로 접고 길면 줄임표로 끊는다. 비면 undefined다. */
export function excerpt(text: string | null | undefined): string | undefined {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  const chars = [...flat];
  return chars.length <= MAX ? flat : `${chars.slice(0, MAX - 1).join("")}…`;
}
