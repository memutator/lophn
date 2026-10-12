// guest 계산을 재현 가능한 단일 script로 묶는다. moduleHash의 정본은
// module-hash.ts다. 추출 규약·guest 실행 규약 버전은 contract.ts가 정한다.
import {
  EXTRACTION_RULES_VERSION,
  GUEST_CONTRACT_VERSION,
} from "./contract.ts";
import { moduleHash } from "./module-hash.ts";

const ENTRY = new URL("./entry.ts", import.meta.url);
const BUNDLE = new URL("./bundle.js", import.meta.url);

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

function stripMachinePaths(source: string): string {
  return source.replaceAll(
    /^\/\/ (?:\.\.\/)+.*$/gm,
    "// dependency",
  );
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
