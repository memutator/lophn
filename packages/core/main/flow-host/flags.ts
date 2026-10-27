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
// biome-ignore lint/suspicious/noControlCharactersInRegex: flag 값이 두 항목으로 갈라지지 않게 제어 문자 범위를 그대로 검사한다.
const ONE_ITEM = /[,\x00-\x1f\x7f]/;

// 넘으면 process가 죽고 program_exited 줄에 끝 code와 stderr가 남는다.
const MEMORY_LIMIT_FLAG = "--v8-flags=--max-old-space-size=512";

export function flowFlags(paths: {
  workflowFolder: string;
  sdkRoot: string;
  // workflow 폴더 안에서 폴더 밖을 가리키는 symlink의 lexical 경로. Deno는 허락한 폴더 안의 link를
  // 따라가므로 deny하지 않으면 flow가 그 대상을 읽는다.
  outsideLinks: readonly string[];
}): Result<string[]> {
  for (const path of [
    paths.workflowFolder,
    paths.sdkRoot,
    ...paths.outsideLinks,
  ]) {
    if (ONE_ITEM.test(path)) {
      return err({
        code: "invalid_input",
        message: "flag value cannot be one item",
      });
    }
  }
  const deny =
    paths.outsideLinks.length === 0
      ? []
      : [`--deny-read=${[...paths.outsideLinks].sort().join(",")}`];
  return ok([
    ...FIXED,
    `--allow-read=${paths.workflowFolder},${paths.sdkRoot}`,
    ...deny,
    MEMORY_LIMIT_FLAG,
  ]);
}

// flag가 entry 뒤로 가면 Deno가 program 인자로 읽어 sandbox가 사라진다. 순서를 이 한 곳에서 정한다.
export function flowArgv(input: {
  workflowFolder: string;
  sdkRoot: string;
  outsideLinks: readonly string[];
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
