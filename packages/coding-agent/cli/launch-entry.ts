// `lophn` launcher가 실행 전에 부르는 권한 계획 entry다. 같은 argv에서 이 실행이 더 열 권한 flag만 한 줄씩
// 낸다: `harness install`의 앱 source 폴더 읽기·쓰기, `harness refresh`가 probe를 돌릴 제품 실행 파일의
// 실행. 계산하지 못하면 아무것도 내지 않는다(그 command는 권한이 없어 unavailable로 끝난다). 오류 내용도
// 내지 않는다: 실제 실행(main.ts)이 같은 입력을 다시 읽고 이유를 낸다.
import { parseArgs } from "./parser.ts";
import { matchCommand } from "./registry.ts";
import { ambientEnv } from "./main.ts";
import { detectedExecutables } from "./commands/harness-run.ts";
import { exactPath, planSelection, selectionFlags } from "./launch.ts";

type Env = { get(name: string): string | undefined };

type PlanOptions = { env?: Env; cwd?: string; home?: string };

function inputOf(
  input: string | undefined,
  file: string | undefined,
  cwd: string,
) {
  try {
    const text = input ??
      (file === undefined ? undefined : Deno.readTextFileSync(
        file.startsWith("/") ? file : `${cwd}/${file}`,
      ));
    const value = text === undefined ? {} : JSON.parse(text);
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

// 이 argv가 더 열 권한 flag들이다. 없으면 빈 배열이다.
function planCliPermissions(
  argv: readonly string[],
  options: PlanOptions = {},
): string[] {
  const parsed = parseArgs(argv);
  if (parsed.errors.length > 0) return [];
  const matched = matchCommand(parsed.positional);
  if (matched === undefined) return [];
  const env = options.env ?? ambientEnv();
  const cwd = options.cwd ?? Deno.cwd();
  const name = matched.entry.name;
  if (name === "harness refresh") {
    const executables = detectedExecutables(
      env,
      options.home ?? env.get("HOME") ?? "",
    ).filter(exactPath);
    return executables.length === 0
      ? []
      : [`--allow-run=${executables.join(",")}`];
  }
  const input = inputOf(parsed.input, parsed.inputFile, cwd);
  if (input === undefined) return [];
  return selectionFlags(
    planSelection(name, input as Record<string, unknown>),
  );
}

if (import.meta.main) {
  try {
    const flags = planCliPermissions(Deno.args);
    if (flags.length > 0) console.log(flags.join("\n"));
  } catch {
    // 계획하지 못하면 아무것도 더하지 않는다.
  }
}
