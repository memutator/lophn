// 인터넷 page의 permission. clipboard write만 main frame의 http/https에 허락하고 나머지는 모두 거절한다.
export function decidePermission(
  input: { permission: string; requestingUrl: string; isMainFrame: boolean },
): boolean {
  if (input.permission !== "clipboard-sanitized-write" || !input.isMainFrame) {
    return false;
  }
  try {
    const { protocol } = new URL(input.requestingUrl);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
