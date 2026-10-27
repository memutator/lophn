// 결과 상한. 목록·검색은 한 번에 20개. 텍스트는 UTF-8 24 KiB와 300줄
// 중 먼저 닿는 곳에서 자른다. 문서는 앞, log는 뒤를 남기고 JSON·Unicode를 깨지
// 않는다.

export const PAGE_SIZE = 20;
export const TEXT_MAX_BYTES = 24 * 1024;
export const TEXT_MAX_LINES = 300;

// cursor는 base64 {after}다. 조건은 호출자가 유지하고 여기는 위치만 옮긴다.

type TextLimit = {
  text: string;
  complete: boolean;
  originalBytes: number;
  originalLines: number;
  omittedCount: number;
};

// direction head는 문서·목록, tail은 log다. 멀티바이트 문자와 JSON 문자열
// 경계를 넘지 않게 UTF-8 code point와 줄 경계에서만 자른다.
export function limitText(text: string, direction: "head" | "tail"): TextLimit {
  const encoded = new TextEncoder().encode(text);
  const lines = text.split("\n");
  const originalBytes = encoded.byteLength;
  const originalLines = lines.length;
  const overBytes = originalBytes > TEXT_MAX_BYTES;
  const overLines = originalLines > TEXT_MAX_LINES;
  if (!overBytes && !overLines) {
    return {
      text,
      complete: true,
      originalBytes,
      originalLines,
      omittedCount: 0,
    };
  }
  const kept =
    direction === "head" ? keepHead(text, lines) : keepTail(text, lines);
  return {
    text: kept,
    complete: false,
    originalBytes,
    originalLines,
    omittedCount: countOmitted(text, kept),
  };
}

function keepHead(text: string, lines: readonly string[]): string {
  const chosen = lines.slice(0, TEXT_MAX_LINES).join("\n");
  return cutBytes(chosen, "head", text);
}

function keepTail(text: string, lines: readonly string[]): string {
  const chosen = lines.slice(-TEXT_MAX_LINES).join("\n");
  return cutBytes(chosen, "tail", text);
}

function cutBytes(
  text: string,
  direction: "head" | "tail",
  original: string,
): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= TEXT_MAX_BYTES) return text;
  const slice =
    direction === "head"
      ? bytes.slice(0, TEXT_MAX_BYTES)
      : bytes.slice(bytes.byteLength - TEXT_MAX_BYTES);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  // 잘린 멀티바이트가 교체 문자로 남으면 그 문자를 버린다.
  const clean = decoded.includes("�")
    ? direction === "head"
      ? decoded.slice(0, decoded.lastIndexOf("�"))
      : decoded.slice(decoded.indexOf("�") + 1)
    : decoded;
  return direction === "tail" && !original.endsWith(clean) ? clean : clean;
}

function countOmitted(original: string, kept: string): number {
  return Math.max(
    0,
    new TextEncoder().encode(original).byteLength -
      new TextEncoder().encode(kept).byteLength,
  );
}

// JSON 결과는 문자열 한가운데를 자르지 않는다. 상한을 넘으면 content를 비우고
// 생략을 표시한다.
export function limitJson(value: unknown): {
  content: unknown;
  complete: boolean;
  originalBytes: number;
} {
  const text = JSON.stringify(value);
  const originalBytes = new TextEncoder().encode(text).byteLength;
  if (originalBytes <= TEXT_MAX_BYTES) {
    return { content: value, complete: true, originalBytes };
  }
  return { content: null, complete: false, originalBytes };
}

// 소유 contract의 cursor를 감싸는 이어 보기 위치다. 조건(scope)을 같이 담아 다른 조건의 목록에서
// 온 cursor를 거절하고, 한 page에서 앞 20개만 보여 준 뒤의 위치(skip)도 지킨다.
// 소유 contract의 cursor는 그대로 안에 둔다. 해석하거나 만들어 내지 않는다.

type FitJson = {
  content: unknown;
  complete: boolean;
  originalBytes: number;
  // 빠진 항목 수. 키마다 따로 content.omitted에도 있다.
  omittedCount: number;
};

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

// 상한을 넘는 JSON 결과는 지정한 배열 키의 뒤쪽 항목부터 덜어 낸다. 항목 하나를 쪼개지 않으므로
// JSON·문자열 경계가 깨지지 않고, 덜어 낸 수는 content.omitted에 남는다. 덜어 낼 배열이
// 없으면 content를 비운다(limitJson과 같다).
export function fitJson(
  value: Record<string, unknown>,
  arrayKeys: readonly string[],
): FitJson {
  const originalBytes = jsonBytes(value);
  if (originalBytes <= TEXT_MAX_BYTES) {
    return { content: value, complete: true, originalBytes, omittedCount: 0 };
  }
  const copy: Record<string, unknown> = { ...value };
  const omitted: Record<string, number> = {};
  // omitted 표시가 들어갈 자리를 먼저 비운다.
  const reserve = 256;
  const arrays = () =>
    arrayKeys.filter(
      (key) => Array.isArray(copy[key]) && (copy[key] as unknown[]).length > 0,
    );
  while (jsonBytes(copy) + reserve > TEXT_MAX_BYTES) {
    const keys = arrays();
    if (keys.length === 0) {
      return {
        content: null,
        complete: false,
        originalBytes,
        omittedCount: 0,
      };
    }
    const longest = keys.reduce((best, key) =>
      (copy[key] as unknown[]).length > (copy[best] as unknown[]).length
        ? key
        : best,
    );
    const items = copy[longest] as unknown[];
    const drop = Math.max(1, Math.floor(items.length / 4));
    copy[longest] = items.slice(0, items.length - drop);
    omitted[longest] = (omitted[longest] ?? 0) + drop;
  }
  copy["omitted"] = omitted;
  return {
    content: copy,
    complete: false,
    originalBytes,
    omittedCount: Object.values(omitted).reduce((a, b) => a + b, 0),
  };
}
