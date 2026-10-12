// QuickJS guest에서 돈다. TextEncoder/TextDecoder와 host 전역을 쓰지 않는다.

export type Utf8Result =
  | { ok: true; text: string }
  | { ok: false; reason: string };

const REPLACEMENT = [0xef, 0xbf, 0xbd];

function continuation(bytes: readonly number[], index: number): number | null {
  const byte = bytes[index];
  if (byte === undefined || (byte & 0xc0) !== 0x80) return null;
  return byte & 0x3f;
}

function appendCodePoint(codePoint: number, out: string[]): void {
  if (codePoint <= 0xffff) {
    out.push(String.fromCharCode(codePoint));
    return;
  }
  const shifted = codePoint - 0x10000;
  out.push(
    String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff)),
  );
}

function appendReplacement(out: string[]): void {
  out.push("�");
}

// WHATWG UTF-8 decode. 잘못된 바이트는 U+FFFD 하나로 바꾸고 실패로 남긴다.
export function decodeUtf8(bytes: readonly number[]): Utf8Result {
  const out: string[] = [];
  let valid = true;
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index]!;
    if (first <= 0x7f) {
      out.push(String.fromCharCode(first));
      index += 1;
      continue;
    }
    const width = first <= 0xdf ? 2 : first <= 0xef ? 3 : first <= 0xf4 ? 4 : 0;
    const lower = first <= 0xdf ? 0x80 : first <= 0xef ? 0x800 : 0x10000;
    const upper = first <= 0xdf ? 0x7ff : first <= 0xef ? 0xffff : 0x10ffff;
    if (width === 0 || index + width > bytes.length) {
      appendReplacement(out);
      valid = false;
      index += 1;
      continue;
    }
    let codePoint = first & (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07);
    let broken = false;
    for (let offset = 1; offset < width; offset += 1) {
      const next = continuation(bytes, index + offset);
      if (next === null) {
        broken = true;
        break;
      }
      codePoint = (codePoint << 6) | next;
    }
    // overlong, surrogate, 범위를 넘는 값은 그 시퀀스 전체를 대체한다.
    if (
      broken || codePoint < lower || codePoint > upper ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      appendReplacement(out);
      valid = false;
      index += broken ? 1 : width;
      continue;
    }
    appendCodePoint(codePoint, out);
    index += width;
  }
  return valid
    ? { ok: true, text: out.join("") }
    : { ok: false, reason: "invalid UTF-8" };
}

function push(bytes: number[], value: number): void {
  bytes.push(value & 0xff);
}

export function encodeUtf8(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (codePoint <= 0x7f) push(bytes, codePoint);
    else if (codePoint <= 0x7ff) {
      push(bytes, 0xc0 | (codePoint >> 6));
      push(bytes, 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      push(bytes, 0xe0 | (codePoint >> 12));
      push(bytes, 0x80 | ((codePoint >> 6) & 0x3f));
      push(bytes, 0x80 | (codePoint & 0x3f));
    } else {
      push(bytes, 0xf0 | (codePoint >> 18));
      push(bytes, 0x80 | ((codePoint >> 12) & 0x3f));
      push(bytes, 0x80 | ((codePoint >> 6) & 0x3f));
      push(bytes, 0x80 | (codePoint & 0x3f));
    }
  }
  return bytes;
}

export const UTF8_REPLACEMENT_BYTES = REPLACEMENT;
