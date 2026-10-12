// guest 계산을 재현 가능한 단일 script로 묶는다. moduleHash의 정본은
// module-hash.ts다. 추출 규약·guest 실행 규약 버전은 contract.ts가 정한다.
import {
  EXTRACTION_RULES_VERSION,
  GUEST_CONTRACT_VERSION,
} from "./contract.ts";
import { moduleHash } from "./module-hash.ts";

const ENTRY = new URL("./entry.ts", import.meta.url);
const BUNDLE = new URL("./bundle.js", import.meta.url);
const FORMATS = new URL("../", import.meta.url).href;

const PINNED_DEPENDENCIES = [
  "parse5@8.0.1",
  "entities@8.1.0",
] as const;

export function bundlePreamble(): string {
  return [
    `// lophn format guest`,
    `// contract ${GUEST_CONTRACT_VERSION}`,
    `// extraction ${EXTRACTION_RULES_VERSION}`,
    `// dependencies ${PINNED_DEPENDENCIES.join(" ")}`,
    "",
  ].join("\n");
}

// esbuild는 묶은 source마다 cwd 기준 경로 주석을 남긴다. 의존성 경로는 기계마다 다르고, formats 안
// 경로는 저장소에서 폴더를 옮기면 바뀐다. 둘 다 module hash를 흔들지 않게 의존성은 고정 글로,
// formats 안 source는 formats 폴더 기준 경로로 바꾼다.
function stripMachinePaths(source: string): string {
  const cwd = new URL(`file://${Deno.cwd()}/`);
  return source
    .replaceAll(/^\/\/ (?:\.\.\/)+.*$/gm, "// dependency")
    .replaceAll(/^\/\/ (\S+\.ts)$/gm, (line, path: string) => {
      const href = new URL(path, cwd).href;
      return href.startsWith(FORMATS)
        ? `// ${decodeURIComponent(href.slice(FORMATS.length))}`
        : line;
    });
}

export async function buildGuestBundle(): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--format",
      "esm",
      ENTRY.pathname,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  const bundled = stripMachinePaths(new TextDecoder().decode(result.stdout));
  const marker = "\nexport {\n  dispatch\n};\n";
  if (!bundled.endsWith(marker)) {
    throw new Error("guest bundle export shape changed");
  }
  const withoutExport = bundled.slice(0, -marker.length) + "\n";
  return `${bundlePreamble()}${withoutExport}\nglobalThis.dispatch = dispatch;\n`;
}

export async function writeGuestBundle(): Promise<string> {
  const source = await buildGuestBundle();
  await Deno.writeTextFile(BUNDLE, source);
  return source;
}

export { moduleHash };

if (import.meta.main) {
  const source = await writeGuestBundle();
  console.log(moduleHash(source));
}
