import { err, ok, type Result } from "../../../base/mod.ts";

// appFlags의 FIXED와 같은 이름·순서다. flow process는 읽기만 허락받고 쓰기·네트워크·run·env는 없다.
const FIXED = [
  "--no-prompt",
  "--no-config",
  "--no-remote",
  "--no-npm",
  "--cached-only",
  "--no-lock",
  "--quiet",
] as const;

// 쉼표나 제어 문자가 있으면 한 flag 값이 두 항목으로 갈라져 허락 범위가 넓어진다.
// deno-lint-ignore no-control-regex
const ONE_ITEM = /[,\x00-\x1f\x7f]/;

export function flowFlags(
  paths: { workflowFolder: string; sdkRoot: string },
): Result<string[]> {
  for (const path of [paths.workflowFolder, paths.sdkRoot]) {
    if (ONE_ITEM.test(path)) {
      return err({
        code: "invalid_input",
        message: "flag value cannot be one item",
      });
    }
  }
  return ok([
    ...FIXED,
    `--allow-read=${paths.workflowFolder},${paths.sdkRoot}`,
  ]);
}

// flag가 entry 뒤로 가면 Deno가 program 인자로 읽어 sandbox가 사라진다. 순서를 이 한 곳에서 정한다.
export function flowArgv(input: {
  workflowFolder: string;
  sdkRoot: string;
  importMap: string;
  entry: string;
  flow: string;
}): Result<string[]> {
  const flags = flowFlags(input);
  if (!flags.ok) return flags;
  return ok([
    "run",
    ...flags.value,
    `--import-map=${input.importMap}`,
    input.entry,
    input.flow,
  ]);
}
