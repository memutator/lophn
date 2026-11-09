// 앱 icon 선언 `lucide:<이름>`의 이름 목록(`packages/core/apps/releases/prepare/lucide-names.ts`)을 shell이 그리는
// lucide-react에서 다시 만든다. lucide가 내는 이름(별칭 포함) 가운데 shell이 실제로 푸는 것(lucideComponentOf)만 담으므로
// release 준비가 받는 이름은 정확히 그릴 수 있는 이름이다. core가 lucide-react(수천 개 icon)를 번들에 끌어들이지 않으려고
// 이름만 복사해 둔다.
// 실행: node tools/lucide-names.ts  (lucide-react 판을 올린 뒤)
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { lucideComponentOf } from "../packages/shell/renderer/parts/icon-upload/lucide-key.ts";

export const LUCIDE_NAMES_FILE = fileURLToPath(
  new URL(
    "../packages/core/apps/releases/prepare/lucide-names.ts",
    import.meta.url,
  ),
);

export async function lucideNamesSource(): Promise<string> {
  // lucide-react는 shell renderer의 의존이다(root workspace에서 풀린다).
  // biome-ignore lint/correctness/noUndeclaredDependencies: tools는 package.json이 없다
  const lucide = (await import("lucide-react")) as Record<string, unknown>;
  // biome-ignore lint/correctness/noUndeclaredDependencies: tools는 package.json이 없다
  const { iconNames } = (await import("lucide-react/dynamic.mjs")) as {
    iconNames: string[];
  };
  const drawable = iconNames.filter(
    (name) => lucideComponentOf(lucide, name) !== undefined,
  );
  const lines: string[] = [];
  let line = "";
  for (const name of [...drawable].sort()) {
    if (line.length + name.length > 100) {
      lines.push(line);
      line = "";
    }
    line += `${line === "" ? "" : " "}${name}`;
  }
  lines.push(line);
  return `// 생성 파일: node tools/lucide-names.ts. lucide-react의 icon 이름(별칭 포함)이다.
const NAMES = \`
${lines.join("\n")}
\`;

export const LUCIDE_ICON_NAMES: ReadonlySet<string> = new Set(
  NAMES.split(/\\s+/).filter(Boolean),
);
`;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeFile(LUCIDE_NAMES_FILE, await lucideNamesSource());
}
