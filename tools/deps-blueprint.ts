import { computedImports, readImports } from "./deps-imports.ts";
import { directory, inside, normalize } from "./deps-workspace.ts";

const BLUEPRINT_ENTRY = "packages/protocol/apps/blueprint.ts";
const NEW_BLUEPRINT_ENTRY = "packages/protocol/apps/blueprint/mod.ts";
const BLUEPRINT_WRAPPER = "packages/core/apps/blueprint/mod.ts";
const SDK = "packages/sdk/blueprint";
const CONTRACT_FILES = new Set([
  BLUEPRINT_ENTRY,
  "packages/protocol/apps/blueprint-types.ts",
  "packages/protocol/apps/blueprint-json.ts",
  "packages/protocol/apps/blueprint-schema.ts",
  "packages/protocol/apps/blueprint-scope.ts",
  "packages/protocol/apps/blueprint/mod.ts",
  "packages/protocol/apps/blueprint/types.ts",
  "packages/protocol/apps/blueprint/json.ts",
  "packages/protocol/apps/blueprint/schema.ts",
  "packages/protocol/apps/blueprint/scope.ts",
  "packages/protocol/apps/blueprint/app-api.ts",
  "packages/protocol/apps/blueprint/uses.ts",
  "packages/protocol/apps/blueprint/value.ts",
]);

type Report = (
  file: string,
  line: number,
  rule: string,
  message: string,
) => void;

// 공개 wrapper는 정본 하나만 직접 import한다. Zod가 든 mod.ts는 아니다. 옛 평면 정본과 새 폴더 정본 둘이
// 있는 동안 둘 다 받는다(옛 것을 지우면 하나만 남긴다).
const wrapperImport = (file: string, target: string) =>
  file === BLUEPRINT_WRAPPER &&
  (target === BLUEPRINT_ENTRY || target === NEW_BLUEPRINT_ENTRY);

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
          ? target === BLUEPRINT_ENTRY || CONTRACT_FILES.has(target) ||
            inside(target, SDK)
          : wrapperImport(file, target));
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
