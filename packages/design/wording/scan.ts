// 화면 코드를 JSX 텍스트와 문자열 literal로 나눈다. 표현식 안의 문자열·template·주석·정규식은
// 괄호 깊이로 세지 않고 건너뛰며, 자식 태그를 닫은 뒤의 부모 텍스트도 계속 읽는다.
export type Segment =
  | { kind: "text"; text: string; start: number }
  | { kind: "string"; text: string; start: number };

const IDENTIFIER = /[A-Za-z0-9_$]/;
const REGEX_AFTER = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "in", "of"]);

export function scan(source: string): Segment[] {
  const out: Segment[] = [];
  const length = source.length;

  function quoted(start: number): number {
    const quote = source[start];
    let index = start + 1;
    while (index < length && source[index] !== quote) {
      if (source[index] === "\\") index += 1;
      else if (source[index] === "\n") break;
      index += 1;
    }
    out.push({ kind: "string", text: source.slice(start + 1, index), start });
    return index + 1;
  }

  function template(start: number): number {
    let index = start + 1;
    while (index < length) {
      const char = source[index];
      if (char === "\\") index += 2;
      else if (char === "`") return index + 1;
      else if (char === "$" && source[index + 1] === "{") {
        index = code(index + 2, true);
      } else index += 1;
    }
    return length;
  }

  function regexAllowed(at: number): boolean {
    let index = at - 1;
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
    if (index < 0) return true;
    if (REGEX_AFTER.has(source[index])) return true;
    let word = "";
    while (index >= 0 && IDENTIFIER.test(source[index])) {
      word = source[index] + word;
      index -= 1;
    }
    return REGEX_KEYWORDS.has(word);
  }

  function regex(start: number): number {
    let index = start + 1;
    let inClass = false;
    while (index < length && source[index] !== "\n") {
      const char = source[index];
      if (char === "\\") index += 1;
      else if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) return index + 1;
      index += 1;
    }
    return index;
  }

  // 이름·닫는 괄호 바로 뒤의 `<`는 `useRef<T>`·`Omit<T>` 같은 generic이나 비교식이다.
  function tagStart(at: number): boolean {
    if (!/[A-Za-z>]/.test(source[at + 1] ?? "")) return false;
    return !/[A-Za-z0-9_$.)\]]/.test(source[at - 1] ?? "");
  }

  // 표현식. closeBrace이면 짝 `}` 다음 위치를 돌려준다.
  function code(start: number, closeBrace: boolean): number {
    let index = start;
    let depth = 0;
    while (index < length) {
      const char = source[index];
      const next = source[index + 1];
      if (char === '"' || char === "'") index = quoted(index);
      else if (char === "`") index = template(index);
      else if (char === "/" && next === "/") {
        const end = source.indexOf("\n", index);
        index = end === -1 ? length : end;
      } else if (char === "/" && next === "*") {
        const end = source.indexOf("*/", index + 2);
        index = end === -1 ? length : end + 2;
      } else if (char === "/" && regexAllowed(index)) index = regex(index);
      else if (char === "{") {
        depth += 1;
        index += 1;
      } else if (char === "}") {
        if (depth === 0 && closeBrace) return index + 1;
        depth -= 1;
        index += 1;
      } else if (char === "<" && tagStart(index)) index = element(index);
      else index += 1;
    }
    return length;
  }

  // `<`에서 시작하는 JSX 요소 하나. 끝난 다음 위치를 돌려준다.
  function element(start: number): number {
    let index = start + 1;
    let selfClosing = false;
    while (index < length) {
      const char = source[index];
      if (char === '"' || char === "'") index = quoted(index);
      else if (char === "{") index = code(index + 1, true);
      else if (char === "/" && source[index + 1] === ">") {
        selfClosing = true;
        index += 2;
        break;
      } else if (char === ">") {
        index += 1;
        break;
      } else index += 1;
    }
    if (selfClosing) return index;
    return children(index);
  }

  function children(start: number): number {
    let index = start;
    while (index < length) {
      const textStart = index;
      while (index < length && source[index] !== "<" && source[index] !== "{") {
        index += 1;
      }
      if (index > textStart) {
        out.push({
          kind: "text",
          text: source.slice(textStart, index),
          start: textStart,
        });
      }
      if (index >= length) return length;
      if (source[index] === "{") index = code(index + 1, true);
      else if (source[index + 1] === "/") {
        const end = source.indexOf(">", index);
        return end === -1 ? length : end + 1;
      } else index = element(index);
    }
    return length;
  }

  code(0, false);
  return out;
}
