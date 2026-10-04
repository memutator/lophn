// Markdown의 link·image 주소를 브라우저 URL parser와 같은 방식으로 정규화한 뒤 허용 protocol만 남긴다.
// React는 문자열을 attribute로 그대로 넣으므로, 실행 가능한 scheme만 막으면 HTML/JS가 실행되지 않는다.
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// URL parser는 앞뒤 C0·공백을 자르고 가운데 tab·줄바꿈을 지운다. 검사도 같은 값을 본다.
// deno-lint-ignore no-control-regex -- URL parser가 지우는 C0 범위를 그대로 따라야 한다.
const EDGE = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
const STRIPPED = /[\t\n\r]/g;
// deno-lint-ignore no-control-regex -- 남은 제어 문자가 있는 주소는 거절한다.
const CONTROL = /[\u0000-\u001f\u007f]/;
const RELATIVE_BASE = "https://relative.invalid/";

export type UrlKind = "link" | "image";

function clean(raw: string): string | undefined {
  const value = raw.replace(EDGE, "").replace(STRIPPED, "");
  if (value === "" || CONTROL.test(value)) return undefined;
  return value;
}

function isRelative(value: string): boolean {
  return !SCHEME.test(value) && !value.startsWith("//");
}

// 허용하면 정규화한 주소를, 아니면 undefined를 돌려준다.
// image의 상대 주소는 문서 위치를 아는 호출자가 resolveImage로 바꾸지 않으면 쓰지 않는다.
export function safeUrl(
  raw: string,
  kind: UrlKind,
  resolveImage?: (relative: string) => string | undefined,
): string | undefined {
  let value = clean(raw);
  if (value === undefined) return undefined;
  if (kind === "image" && isRelative(value)) {
    const resolved = resolveImage?.(value);
    if (resolved === undefined) return undefined;
    value = clean(resolved);
    if (value === undefined || isRelative(value)) return undefined;
  }
  let protocol: string;
  try {
    protocol = new URL(value, RELATIVE_BASE).protocol;
  } catch {
    return undefined;
  }
  const allowed = kind === "link" ? LINK_PROTOCOLS : IMAGE_PROTOCOLS;
  return allowed.has(protocol) ? value : undefined;
}
