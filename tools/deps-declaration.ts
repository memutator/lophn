import { computedImports, readImports } from "./deps-imports.ts";
import { directory, inside, normalize } from "./deps-workspace.ts";

const DECLARATION_ENTRY = "packages/protocol/apps/declaration/mod.ts";
const DECLARATION_WRAPPER = "packages/core/apps/declaration/mod.ts";
const SDK = "packages/sdk/declaration";
const CONTRACT_FILES = new Set([
  DECLARATION_ENTRY,
  "packages/protocol/apps/declaration/types.ts",
  "packages/protocol/apps/declaration/json.ts",
  "packages/protocol/apps/declaration/schema.ts",
  "packages/protocol/apps/declaration/scope.ts",
  "packages/protocol/apps/declaration/tools.ts",
  "packages/protocol/apps/declaration/uses.ts",
  "packages/protocol/apps/declaration/value.ts",
]);

type Report = (
  file: string,
  line: number,
  rule: string,
  message: string,
) => void;

// 공개 wrapper는 정본 하나만 직접 import한다. Zod가 든 read.ts·check.ts는 아니다.
const wrapperImport = (file: string, target: string) =>
  file === DECLARATION_WRAPPER && target === DECLARATION_ENTRY;

export function checkDeclarationGraph(
  sources: Map<string, string>,
  add: Report,
): void {
  const pending = [DECLARATION_ENTRY, DECLARATION_WRAPPER, `${SDK}/mod.ts`];
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
        "declaration-pure",
        "순수 declaration graph는 계산 import 금지",
      );
    }
    for (const { specifier, line } of readImports(source)) {
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../");
      const target = normalize(`${directory(file)}/${specifier}`);
      const module =
        relative &&
        specifier.endsWith(".ts") &&
        !target.endsWith("_test.ts") &&
        sources.has(target);
      const allowed =
        module &&
        (CONTRACT_FILES.has(file)
          ? CONTRACT_FILES.has(target)
          : inside(file, SDK)
            ? CONTRACT_FILES.has(target) || inside(target, SDK)
            : wrapperImport(file, target));
      if (!allowed) {
        add(
          file,
          line,
          "declaration-pure",
          `순수 declaration graph는 정본과 자기 순수 모듈의 상대 .ts만 import: ${specifier}`,
        );
        continue;
      }
      pending.push(target);
    }
  }
}
