// Markdown 글의 escape와 HTML entity를 글자로 바꾼다. 결과는 React 글로만 쓴다.
// 글자는 code point로 적는다. 원문에 기호 글자를 두지 않는다.
const NAMED: Record<string, string> = Object.fromEntries(
  Object.entries({
    amp: 0x26,
    lt: 0x3c,
    gt: 0x3e,
    quot: 0x22,
    apos: 0x27,
    nbsp: 0xa0,
    copy: 0xa9,
    reg: 0xae,
    hellip: 0x2026,
    mdash: 0x2014,
    ndash: 0x2013,
    middot: 0xb7,
  }).map(([name, code]) => [name, String.fromCodePoint(code)]),
);
const REPLACEMENT = String.fromCodePoint(0xfffd);

export function decodeEntity(entity: string): string {
  const body = entity.slice(1, -1);
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff &&
      (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : REPLACEMENT;
  }
  return NAMED[body] ?? entity;
}

// 주소·code info 같은 원문 조각의 backslash escape와 entity를 푼다.
export function unescapeText(text: string): string {
  return text
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(
      /&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z\d]{1,31});/g,
      decodeEntity,
    );
}
