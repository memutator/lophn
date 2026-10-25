const SLUG_MAX = 63;

/**
 * 앱 이름에서 slug를 만든다. 영문 숫자가 하나도 없는 이름(한글 등)이면 `fallback`으로 정한다.
 * `fallback`은 소문자와 숫자만 쓴다. agent tool과 런처의 New app이 같은 규칙을 쓴다.
 */
export function appSlugOf(name: string, fallback: string): string {
  const slug = name.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug === "" ? `app-${fallback}` : slug;
}
