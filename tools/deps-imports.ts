type Token = { value: string; string?: boolean; line: number };
export type ImportSpecifier = { specifier: string; line: number };

// 문자열·주석 안의 import를 코드로 보지 않도록 먼저 token으로 나눈다.
function tokens(source: string): Token[] {
  const result: Token[] = [];
  let index = 0;
  let line = 1;
  const advance = () => {
    if (source[index] === "\n") line++;
    return source[index++];
  };
  function quoted(quote: string): string {
    advance();
    let value = "";
    while (index < source.length && source[index] !== quote) {
      const char = advance();
      if (char !== "\\") {
        value += char;
        continue;
      }
      const escaped = advance();
      const escapes: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        v: "\v",
        "0": "\0",
      };
      if (escaped === "\n") continue;
      if (escaped === "\r") {
        if (source[index] === "\n") advance();
        continue;
      }
      if (escaped === "u" || escaped === "x") {
        const braced = escaped === "u" && source[index] === "{";
        if (braced) advance();
        const start = index;
        if (braced) {
          while (index < source.length && source[index] !== "}") advance();
        } else {
          for (let count = 0; count < (escaped === "u" ? 4 : 2); count++) {
            advance();
          }
        }
        value += String.fromCodePoint(parseInt(source.slice(start, index), 16));
        if (braced) advance();
      } else {
        value += escapes[escaped] ?? escaped;
      }
    }
    if (source[index] === quote) advance();
    return value;
  }
  function code(templateExpression = false) {
    let braces = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) {
        advance();
      } else if (source.startsWith("//", index)) {
        while (index < source.length && source[index] !== "\n") advance();
      } else if (source.startsWith("/*", index)) {
        advance();
        advance();
        while (index < source.length && !source.startsWith("*/", index)) {
          advance();
        }
        if (index < source.length) {
          advance();
          advance();
        }
      } else if (char === "'" || char === '"') {
        const startLine = line;
        result.push({ value: quoted(char), string: true, line: startLine });
      } else if (char === "`") {
        advance();
        result.push({ value: "`", line });
        while (index < source.length && source[index] !== "`") {
          if (source[index] === "\\") {
            advance();
            advance();
          } else if (source.startsWith("${", index)) {
            advance();
            advance();
            code(true);
          } else advance();
        }
        if (source[index] === "`") advance();
        result.push({ value: "`", line });
      } else if (
        char === "/" &&
        (!result.length ||
          /^(?:[=(:,;!{\[?]|return|throw|=>)$/.test(result.at(-1)!.value))
      ) {
        advance();
        let inClass = false;
        while (index < source.length) {
          const part = advance();
          if (part === "\\") advance();
          else if (part === "[") inClass = true;
          else if (part === "]") inClass = false;
          else if (part === "/" && !inClass) break;
        }
        while (/[a-z]/i.test(source[index] ?? "")) advance();
        result.push({ value: "/regex/", line });
      } else if (/[\w$]/.test(char)) {
        const start = index;
        const startLine = line;
        while (index < source.length && /[\w$]/.test(source[index])) advance();
        result.push({ value: source.slice(start, index), line: startLine });
      } else {
        if (templateExpression && char === "}" && braces === 0) {
          advance();
          return;
        }
        if (char === "{") braces++;
        if (char === "}") braces--;
        result.push({ value: advance(), line });
      }
    }
  }
  code();
  return result;
}

export function readImports(source: string): ImportSpecifier[] {
  const list = tokens(source);
  const imports: ImportSpecifier[] = [];
  for (let index = 0; index < list.length; index++) {
    const token = list[index];
    if (token.string || !["import", "export"].includes(token.value)) continue;
    if ([".", "?"].includes(list[index - 1]?.value)) continue;
    const next = list[index + 1];
    if (!next) continue;
    let specifier: Token | undefined;
    if (token.value === "import" && next.string) specifier = next;
    else if (token.value === "import" && next.value === "(") {
      if (
        list[index + 2]?.string && [")", ","].includes(list[index + 3]?.value)
      ) {
        specifier = list[index + 2];
      }
    } else if (next.value !== "." && next.value !== "(") {
      if (
        token.value === "export" && !["{", "*", "type"].includes(next.value)
      ) continue;
      let depth = 0;
      for (let cursor = index + 1; cursor < list.length; cursor++) {
        const item = list[cursor];
        if (!item.string && ["{", "["].includes(item.value)) depth++;
        if (!item.string && ["}", "]"].includes(item.value)) depth--;
        if (
          depth === 0 && item.value === "from" && !item.string &&
          list[cursor + 1]?.string
        ) {
          specifier = list[cursor + 1];
          break;
        }
        if (
          depth === 0 && [";", "=", "import", "export"].includes(item.value)
        ) break;
      }
    }
    if (specifier) {
      imports.push({ specifier: specifier.value, line: token.line });
    }
  }
  return imports;
}
