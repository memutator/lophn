// guest 계산을 재현 가능한 단일 script로 묶고 module_hash를 계산한다.
// hash는 묶음 코드, 고정 의존 버전, 추출 규칙 버전, guest 실행 규약 버전을 덮는다.
import { sha256Text } from "../pure/sha256.ts";
import { GUEST_CONTRACT_VERSION } from "./contract.ts";

const ENTRY = new URL("./entry.ts", import.meta.url);
const BUNDLE = new URL("./bundle.js", import.meta.url);

// 추출 규칙을 바꾸면 이 번호를 올린다. 같은 hash 아래 규칙을 덮어쓰지 않는다.
export const EXTRACTION_RULES_VERSION = 1;

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

export function moduleHash(bundle: string): string {
  return sha256Text(JSON.stringify({
    contract: GUEST_CONTRACT_VERSION,
    extraction: EXTRACTION_RULES_VERSION,
    dependencies: PINNED_DEPENDENCIES,
    bundle,
  }));
}

if (import.meta.main) {
  const source = await writeGuestBundle();
  console.log(moduleHash(source));
}
