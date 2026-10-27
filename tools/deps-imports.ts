type Token = {
  value: string;
  string?: boolean;
  line: number;
  start: number;
  end: number;
};
type ImportSpecifier = { specifier: string; line: number };
// start·end는 따옴표까지 포함한 문자열의 자리다.
type SpecifierSite = {
  specifier: string;
  line: number;
  start: number;
  end: number;
};

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
        const start = index;
        const value = quoted(char);
        result.push({
          value,
          string: true,
          line: startLine,
          start,
          end: index,
        });
      } else if (char === "`") {
        const start = index;
        advance();
        result.push({ value: "`", line, start, end: index });
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
        const close = index;
        if (source[index] === "`") advance();
        result.push({ value: "`", line, start: close, end: index });
      } else if (
        char === "/" &&
        (!result.length ||
          /^(?:[=(:,;!{\[?]|return|throw|=>)$/.test(result.at(-1)!.value))
      ) {
        const start = index;
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
        result.push({ value: "/regex/", line, start, end: index });
      } else if (/[\w$]/.test(char)) {
        const start = index;
        const startLine = line;
        while (index < source.length && /[\w$]/.test(source[index])) advance();
        result.push({
          value: source.slice(start, index),
          line: startLine,
          start,
          end: index,
        });
      } else {
        if (templateExpression && char === "}" && braces === 0) {
          advance();
          return;
        }
        if (char === "{") braces++;
        if (char === "}") braces--;
        const start = index;
        const value = advance();
        result.push({ value, line, start, end: index });
      }
    }
  }
  code();
  return result;
}

// 순수 graph에서 계산 import로 dependency 검사를 우회하지 못하게 한다.
export function computedImports(source: string): number[] {
  const list = tokens(source);
  return list.flatMap((token, index) => {
    if (
      token.string ||
      token.value !== "import" ||
      [".", "?"].includes(list[index - 1]?.value) ||
      list[index + 1]?.value !== "("
    )
      return [];
    return list[index + 2]?.string &&
      [")", ","].includes(list[index + 3]?.value)
      ? []
      : [token.line];
  });
}

function importSites(list: Token[]): { token: Token; line: number }[] {
  const imports: { token: Token; line: number }[] = [];
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
        list[index + 2]?.string &&
        [")", ","].includes(list[index + 3]?.value)
      ) {
        specifier = list[index + 2];
      }
    } else if (next.value !== "." && next.value !== "(") {
      if (token.value === "export" && !["{", "*", "type"].includes(next.value))
        continue;
      let depth = 0;
      for (let cursor = index + 1; cursor < list.length; cursor++) {
        const item = list[cursor];
        if (!item.string && ["{", "["].includes(item.value)) depth++;
        if (!item.string && ["}", "]"].includes(item.value)) depth--;
        if (
          depth === 0 &&
          item.value === "from" &&
          !item.string &&
          list[cursor + 1]?.string
        ) {
          specifier = list[cursor + 1];
          break;
        }
        if (depth === 0 && [";", "=", "import", "export"].includes(item.value))
          break;
      }
    }
    if (specifier) imports.push({ token: specifier, line: token.line });
  }
  return imports;
}

export function readImports(source: string): ImportSpecifier[] {
  return importSites(tokens(source)).map(({ token, line }) => ({
    specifier: token.value,
    line,
  }));
}

const site = (token: Token, line: number): SpecifierSite => ({
  specifier: token.value,
  line,
  start: token.start,
  end: token.end,
});

// 옮기기 도구가 고칠 자리다. import·export from·import()에 더해
// new URL("…", import.meta.url)과 import.meta.resolve("…")의 문자열을 낸다.
export function readSpecifierSites(source: string): SpecifierSite[] {
  const list = tokens(source);
  const sites = importSites(list).map(({ token, line }) => site(token, line));
  const word = (index: number, value: string) =>
    !list[index]?.string && list[index]?.value === value;
  const meta = (index: number, last: string) =>
    word(index, "import") &&
    word(index + 1, ".") &&
    word(index + 2, "meta") &&
    word(index + 3, ".") &&
    word(index + 4, last);
  for (let index = 0; index < list.length; index++) {
    if (
      word(index, "new") &&
      word(index + 1, "URL") &&
      word(index + 2, "(") &&
      list[index + 3]?.string &&
      word(index + 4, ",") &&
      meta(index + 5, "url")
    ) {
      sites.push(site(list[index + 3], list[index + 3].line));
    } else if (
      meta(index, "resolve") &&
      word(index + 5, "(") &&
      list[index + 6]?.string &&
      word(index + 7, ")")
    ) {
      sites.push(site(list[index + 6], list[index + 6].line));
    }
  }
  return sites.sort((a, b) => a.start - b.start);
}

// 모든 문자열 literal의 자리다. 옮긴 경로를 문자열로 쓰는 곳을 찾는 데 쓴다.
export function readStringSites(source: string): SpecifierSite[] {
  return tokens(source)
    .filter((token) => token.string)
    .map((token) => site(token, token.line));
}
