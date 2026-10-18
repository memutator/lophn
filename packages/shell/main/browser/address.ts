// 주소 칸 입력 정리. 거절은 decideNavigation이 하므로 여기서는 scheme만 채운다. 검색어는 다루지 않는다.
const KEEP_SCHEMES = /^(about|mailto|tel|javascript|data|file|blob|chrome):/i;

export function normalizeAddress(text: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  if (t.includes("://") || KEEP_SCHEMES.test(t)) return t;
  const host = (t.split(/[/?#]/, 1)[0] ?? "").replace(/:\d*$/, "");
  const withScheme = (host === "localhost" || host === "127.0.0.1")
    ? `http://${t}`
    : `https://${t}`;
  try {
    new URL(withScheme);
  } catch {
    return null;
  }
  return withScheme;
}
