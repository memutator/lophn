// browser 주소 칸의 검색 엔진 설정. preset과 사용자 URL template(`%s` 자리표시자)을 core 설정 선언,
// shell main의 주소 정리, Settings › Browser 화면이 같이 쓴다.
export const BROWSER_SEARCH_ENGINE_SETTING = "shell.browser.search_engine";
export const BROWSER_SEARCH_ENGINE_CUSTOM_SETTING =
  "shell.browser.search_engine_custom";

export const BUILTIN_SEARCH_ENGINES = {
  google: "https://www.google.com/search?q=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  naver: "https://search.naver.com/search.naver?query=%s",
  brave: "https://search.brave.com/search?q=%s",
  perplexity: "https://www.perplexity.ai/search?q=%s",
} as const;

export type BuiltinSearchEngineId = keyof typeof BUILTIN_SEARCH_ENGINES;

export const SEARCH_ENGINE_IDS = [
  "google",
  "duckduckgo",
  "bing",
  "naver",
  "brave",
  "perplexity",
  "custom",
] as const;

export type SearchEngineId = (typeof SEARCH_ENGINE_IDS)[number];

export const DEFAULT_SEARCH_ENGINE: BuiltinSearchEngineId = "google";

export const CUSTOM_SEARCH_URL_MAX = 2048;

/** 사용자 검색 URL template이 http(s) 주소이고 `%s`를 포함하는지 본다. */
export function isValidCustomSearchUrl(template: string): boolean {
  const trimmed = template.trim();
  if (trimmed === "" || trimmed.length > CUSTOM_SEARCH_URL_MAX) return false;
  if (!trimmed.includes("%s")) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed.replaceAll("%s", "lophn"));
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return true;
}

/** 설정 값에서 지금 쓸 검색 URL template을 고른다. custom이 비었거나 틀리면 기본(Google)이다. */
export function resolveSearchTemplate(
  engine: unknown,
  custom: unknown,
): string {
  if (
    engine === "custom" &&
    typeof custom === "string" &&
    isValidCustomSearchUrl(custom)
  ) {
    return custom.trim();
  }
  if (
    typeof engine === "string" &&
    Object.hasOwn(BUILTIN_SEARCH_ENGINES, engine)
  ) {
    return BUILTIN_SEARCH_ENGINES[engine as BuiltinSearchEngineId];
  }
  return BUILTIN_SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE];
}

/** template의 `%s`를 URL 인코딩한 검색어로 채운다. */
export function buildSearchUrl(template: string, query: string): string {
  const encoded = encodeURIComponent(query);
  return template.replaceAll("%s", () => encoded);
}
