export type SourceFile = { path: string; text: string };

export type CodeUsage = {
  // 문자열 literal로 부른 code와 부른 자리.
  literals: { code: string; path: string }[];
  // literal이 아닌 인자로 부른 자리. 정적으로 code를 알 수 없다.
  dynamic: { path: string }[];
};

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|[^:])\/\/.*$/gm,
    "$1",
  );
}

const CALL =
  /\breportProblem\s*\(\s*(?:(["'`])((?:(?!\1)[^\\\n])*)\1\s*[,)]|([^)\s][^)]*)?)/g;

// 정적 code 사용 검사: 앱 source의 reportProblem 호출을 읽는다.
// 선언 없는 code와 계산해 만든 code를 가려내는 데 쓴다.
export function scanCodeUsage(files: readonly SourceFile[]): CodeUsage {
  const usage: CodeUsage = { literals: [], dynamic: [] };
  for (const file of files) {
    const text = stripComments(file.text);
    for (const match of text.matchAll(CALL)) {
      const quote = match[1];
      const body = match[2];
      if (
        quote && body !== undefined && !(quote === "`" && body.includes("${"))
      ) {
        usage.literals.push({ code: body, path: file.path });
      } else if (match[0].trim() !== "reportProblem(") {
        usage.dynamic.push({ path: file.path });
      }
    }
  }
  return usage;
}

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs)$/;

// 고정 source 폴더의 앱 source만 읽는다. test code와 의존 폴더(봉인 bundle의 sdk 사본, 화면 build)는 뺀다.
export async function loadSources(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  async function visit(directory: string, relative: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (
          entry.name === "node_modules" || entry.name === "tests" ||
          (relative === "" &&
            (entry.name === "sdk" || entry.name === "screens"))
        ) continue;
        await visit(`${directory}/${entry.name}`, path);
      } else if (
        entry.isFile && SOURCE_EXT.test(entry.name) &&
        !/_test\.[a-z]+$/.test(entry.name)
      ) {
        files.push({
          path,
          text: await Deno.readTextFile(`${directory}/${entry.name}`),
        });
      }
    }
  }
  await visit(root, "");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
