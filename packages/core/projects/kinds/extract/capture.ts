// `from: path` 칸의 capture(예 `receipts/{year}/*.md`)를 그릇 폴더 기준 경로에 맞춰 `{이름}`의 글을 뽑는다.
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}|\*\*|\*|[\s\S]/g;

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

export type Capturer = (path: string) => Record<string, string> | null;

// `{이름}`은 한 칸(`[^/]+`), `*`는 한 칸 안(`[^/]*`), `**`는 여러 칸(`.*`)이고 나머지는 글자 그대로다.
export function compileCapture(pattern: string): Capturer {
  const names: string[] = [];
  let source = "";
  for (const [token, name] of pattern.matchAll(PLACEHOLDER)) {
    if (name !== undefined) {
      names.push(name);
      source += "([^/]+)";
    } else if (token === "**") source += ".*";
    else if (token === "*") source += "[^/]*";
    else source += escape(token);
  }
  const regex = new RegExp(`^${source}$`);
  return (path) => {
    const match = regex.exec(path);
    if (match === null) return null;
    const found: Record<string, string> = {};
    names.forEach((name, index) => {
      found[name] ??= match[index + 1]!;
    });
    return found;
  };
}
