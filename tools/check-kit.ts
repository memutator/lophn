// kit 동기화 검사: wireframes의 CSS 위치, 분류 mod.ts의 component가 pages/kit에 나오는지,
// design component 폴더 모양과 mod.ts 한 줄 문서.
// 실행: node tools/check-kit.ts [root]
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";

import { walk } from "./check-deps.ts";

type Issue = { file: string; line: number; message: string };

const CATEGORIES = [
  "primitives",
  "input",
  "layout",
  "navigation",
  "data",
  "feedback",
  "overlay",
  "reading",
];
const COMPONENTS = "packages/design/components";
const KIT_PAGES = "tools/wireframes/pages/kit";
// drafts/ 밖에서 CSS를 허용하는 둘. gallery 틀과 kit 쪽 배치 전용이다.
const CSS_ALLOWED = new Set([
  "tools/wireframes/gallery.module.css",
  `${KIT_PAGES}/kit.module.css`,
]);

// 주석과 줄 끝 주석을 비워 줄 번호는 그대로 둔 text.
function codeOf(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.trimStart().startsWith("//") ? "" : line.replace(/\s\/\/.*$/, ""),
    )
    .join("\n");
}

type ExportStatement = {
  line: number;
  typeOnly: boolean;
  names: { name: string; line: number; isType: boolean }[];
};

function exportStatements(text: string): ExportStatement[] {
  const code = codeOf(text);
  const lineAt = (offset: number) => code.slice(0, offset).split("\n").length;
  const result: ExportStatement[] = [];
  for (const m of code.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    const typeOnly = !!m[1];
    const bodyStart = m.index + m[0].indexOf("{") + 1;
    const names: ExportStatement["names"] = [];
    let at = bodyStart;
    for (const part of m[2].split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        const isType = typeOnly || /^type\s/.test(trimmed);
        const name = trimmed
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()!;
        names.push({
          name,
          line: lineAt(at + part.indexOf(trimmed)),
          isType,
        });
      }
      at += part.length + 1;
    }
    result.push({ line: lineAt(m.index), typeOnly, names });
  }
  return result;
}

// 첫 글자가 대문자이고 소문자가 있다: component, Context, Provider. READING_WIDTHS 같은 상수는 아니다.
const isPascal = (name: string) =>
  /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);

export async function checkKit(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const add = (file: string, line: number, message: string) =>
    issues.push({ file, line, message });
  const { files } = await walk(root);
  const read = (file: string) => readFile(`${root}/${file}`, "utf8");

  // 1. drafts/ 밖의 CSS
  for (const file of files) {
    if (!file.startsWith("tools/wireframes/") || !file.endsWith(".css")) {
      continue;
    }
    if (file.startsWith("tools/wireframes/drafts/") || CSS_ALLOWED.has(file)) {
      continue;
    }
    add(
      file,
      1,
      "drafts/ 밖의 CSS다. 실제 component를 import하거나 drafts/로 옮긴다",
    );
  }

  // 2. 분류 mod.ts의 component가 pages/kit에 나온다
  const kitText = (
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${KIT_PAGES}/`) && /\.tsx?$/.test(f))
        .map(read),
    )
  ).join("\n");
  for (const category of CATEGORIES) {
    const file = `${COMPONENTS}/${category}/mod.ts`;
    let text: string;
    try {
      text = await read(file);
    } catch {
      continue; // 없음은 3(b)가 알린다
    }
    for (const statement of exportStatements(text)) {
      for (const { name, line, isType } of statement.names) {
        if (isType || !isPascal(name)) continue;
        if (!new RegExp(`\\b${name}\\b`).test(kitText)) {
          add(file, line, `${name}이 pages/kit에 나오지 않는다`);
        }
      }
    }

    // 3(d). 값을 내보내는 export 문 바로 윗줄은 한 줄 문서
    const lines = text.split("\n");
    for (const statement of exportStatements(text)) {
      if (statement.names.every((n) => n.isType)) continue;
      if (!/^\s*\/\/\s*\S/.test(lines[statement.line - 2] ?? "")) {
        add(
          file,
          statement.line,
          "export 문 바로 윗줄에 한 줄 문서(//)가 없다",
        );
      }
    }
  }

  // 3(a). components 바로 아래 항목
  const allowedTop = new Set([...CATEGORIES, "_shared", "css-modules.d.ts"]);
  for (const name of await readdir(`${root}/${COMPONENTS}`)) {
    if (!allowedTop.has(name)) {
      add(
        `${COMPONENTS}/${name}`,
        1,
        "분류 폴더, _shared, css-modules.d.ts 밖의 항목이다",
      );
    }
  }
  // 3(b). mod.ts
  for (const dir of [...CATEGORIES, "_shared"]) {
    if (!files.includes(`${COMPONENTS}/${dir}/mod.ts`)) {
      add(`${COMPONENTS}/${dir}/mod.ts`, 1, "mod.ts가 없다");
    }
  }
  // 3(c). .tsx는 분류 폴더나 _shared 안에만
  const homes = [...CATEGORIES, "_shared"].map((d) => `${COMPONENTS}/${d}/`);
  for (const file of files) {
    if (!file.startsWith("packages/design/") || !file.endsWith(".tsx")) {
      continue;
    }
    // 폰 UI kit(React Native)은 자기 폴더 꼴을 갖고 mobile/의 tsconfig가 검사한다.
    if (file.startsWith("packages/design/native/")) continue;
    if (!homes.some((h) => file.startsWith(h))) {
      add(file, 1, "design의 .tsx가 분류 폴더나 _shared 밖에 있다");
    }
  }
  return issues;
}

if (import.meta.main) {
  try {
    const issues = await checkKit(process.argv[2] ?? process.cwd());
    for (const i of issues) console.error(`${i.file}:${i.line} ${i.message}`);
    if (!issues.length) console.log("kit: 통과");
    process.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `kit: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
