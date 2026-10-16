// 소스 낱말 검사: 주석과 test 이름의 옛 요구 ID·작업 번호, 쓰지 않는 말.
// 실행: deno run --allow-read tools/check-source.ts [root]
// 이름과 경로의 판·단계·작업 번호는 check-deps.ts가, 화면 문구는 check-wording.ts가 본다.
import { walk } from "./check-deps.ts";

type Issue = { file: string; line: number; rule: string; message: string };

// 주석이나 test 이름에서만 보는 꼴. 코드 안의 hex 색 같은 것과 섞이지 않게 한다. TODO는 남기지 않는다(남길 일은 작업으로).
const NUMBERED: [RegExp, string][] = [
  [/req-\d{3,}|#R\d+\b|\[R\d+\]/, "옛 요구 ID"],
  [/\b[TQDW]\d{2,3}\b/, "작업 번호"],
  [/\bS[1-9]\b/, "spec 번호"],
  [/\b(?:TODO|FIXME)\b/, "TODO"],
];

// 지운 기능과 바꾼 말 중 grep으로 오탐 없이 잡히는 옛 말. 옛 말 표는 git tag docs-before-trim에 있다.
const FORBIDDEN: [RegExp, string][] = [
  [/file-tracking/, "file-tracking"],
  [/doc@ver/, "doc@ver"],
  [/documents#/, "의도 참조(documents#)"],
  [/place 없는 문서/, "place 없는 문서"],
  [/series registry/i, "series registry"],
  [/change notification|바뀜 알림/i, "바뀜 알림(change notification)"],
  [/revert_run|run revert|run 되돌리기/, "run revert(session rewind로)"],
  [/Roles 화면|대화 dock/, "Roles 화면·대화 dock"],
  [/app-capability-api/, "app-capability-api(app-capability로)"],
  [/app-packages/, "app-packages(package-registry로)"],
  [/용어 후보/, "용어 후보(용어집으로)"],
];

const SOURCE = /\.(?:tsx?|js|css)$/;

// 줄에서 주석 부분. URL의 //는 앞에 공백이 없어 걸리지 않는다.
function commentOf(line: string): string | undefined {
  const text = line.trimStart();
  if (text.startsWith("*") || text.startsWith("/*")) return line;
  return /(?:^|\s)\/\/.*|\/\*.*/.exec(line)?.[0];
}

const TEST_NAME = /\b(?:Deno\.test|test|it|describe)\(\s*["'`]/;

export async function checkSource(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const { files } = await walk(root);
  for (const file of files) {
    if (!/^(?:packages|tools)\//.test(file) || !SOURCE.test(file)) continue;
    if (file === "tools/check-source.ts") continue;
    const lines = (await Deno.readTextFile(`${root}/${file}`)).split("\n");
    lines.forEach((line, index) => {
      const at = (rule: string, message: string) =>
        issues.push({ file, line: index + 1, rule, message });
      const text = TEST_NAME.test(line) ? line : commentOf(line);
      if (text) {
        for (const [pattern, name] of NUMBERED) {
          if (pattern.test(text)) at("number", `주석·test 이름에 ${name} 금지`);
        }
      }
      for (const [pattern, name] of FORBIDDEN) {
        if (pattern.test(line)) at("term", `쓰지 않는 말: ${name}`);
      }
    });
  }
  return issues;
}

if (import.meta.main) {
  try {
    const issues = await checkSource(Deno.args[0] ?? Deno.cwd());
    for (const i of issues) {
      console.error(`${i.file}:${i.line} [${i.rule}] ${i.message}`);
    }
    if (!issues.length) console.log("source: 통과");
    Deno.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `source: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }
}
