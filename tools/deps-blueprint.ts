import { computedImports, readImports } from "./deps-imports.ts";
import { directory, inside, normalize } from "./deps-workspace.ts";

export const BLUEPRINT_ENTRY = "packages/contracts/apps/blueprint.ts";
export const BLUEPRINT_WRAPPER = "packages/apps/blueprint/mod.ts";
const SDK = "packages/sdk/blueprint";
const CONTRACT_FILES = new Set([
  BLUEPRINT_ENTRY,
  "packages/contracts/apps/blueprint-types.ts",
  "packages/contracts/apps/blueprint-json.ts",
  "packages/contracts/apps/blueprint-schema.ts",
  "packages/contracts/apps/blueprint-scope.ts",
  "packages/contracts/apps/blueprint-commands.ts",
  "packages/contracts/apps/blueprint-uses.ts",
  "packages/contracts/apps/blueprint-value.ts",
]);

type Report = (
  file: string,
  line: number,
  rule: string,
  message: string,
) => void;

const PURE_CONTRACT = "packages/contracts/apps/blueprint-scope.ts";
const PERMISSIONS = "packages/apps/permissions/";

// Zod-bearing mod.ts 대신 정본 하나만 공개 wrapper에 허용한다.
// permissions는 host 판정 정본(blueprint-scope)만 직접 쓴다. Zod mod.ts는 아니다.
const EXTRACT_CHILD = "packages/apps/blueprint/extract-child.ts";
const EXTRACT_CHILD_FILES = new Set([
  "packages/contracts/apps/blueprint-json.ts",
  "packages/contracts/apps/blueprint-value.ts",
]);

export function blueprintEntryImport(file: string, target: string): boolean {
  if (file === BLUEPRINT_WRAPPER && target === BLUEPRINT_ENTRY) return true;
  if (file === EXTRACT_CHILD && EXTRACT_CHILD_FILES.has(target)) return true;
  return file.startsWith(PERMISSIONS) && target === PURE_CONTRACT;
}

export function checkBlueprintGraph(
  sources: Map<string, string>,
  add: Report,
): void {
  const pending = [BLUEPRINT_ENTRY, BLUEPRINT_WRAPPER, `${SDK}/mod.ts`];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = sources.get(file);
    // 다른 slice가 아직 만들지 않은 wrapper는 검사의 선행이 아니다.
    if (source === undefined) continue;
    for (const line of computedImports(source)) {
      add(
        file,
        line,
        "blueprint-pure",
        "순수 blueprint graph는 계산 import 금지",
      );
    }
    for (const { specifier, line } of readImports(source)) {
      const relative = specifier.startsWith("./") ||
        specifier.startsWith("../");
      const target = normalize(`${directory(file)}/${specifier}`);
      const module = relative && specifier.endsWith(".ts") &&
        !target.endsWith("_test.ts") && sources.has(target);
      const allowed = module &&
        (CONTRACT_FILES.has(file)
          ? CONTRACT_FILES.has(target)
          : inside(file, SDK)
          ? target === BLUEPRINT_ENTRY || inside(target, SDK)
          : blueprintEntryImport(file, target));
      if (!allowed) {
        add(
          file,
          line,
          "blueprint-pure",
          `순수 blueprint graph는 정본과 자기 순수 모듈의 상대 .ts만 import: ${specifier}`,
        );
        continue;
      }
      pending.push(target);
    }
  }
}
