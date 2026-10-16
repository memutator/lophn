// `blueprint.check`. 앱 source의 현재 blueprint.ts를 release 준비와 같은 방식(권한 좁은 Deno)으로 평가하고
// 구조 검사와 설명 빈 칸을 본다. release를 만들지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { BlueprintCheckOutput } from "../../../protocol/apps/mod.ts";
import { validateBlueprint } from "../../../protocol/apps/blueprint/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { devImportMap } from "../packages/mod.ts";
import { descriptionGaps } from "./describe.ts";

export type BlueprintCheckDeps = {
  dataRoot: string;
  // 호출자가 그 앱을 열 수 있는지 보고 연결된 source 폴더를 돌려준다. 범위 밖이면 err다.
  sourceRootOf: (
    ctx: Parameters<MemoryHandler>[0],
    app: string,
  ) => Promise<Result<string>>;
};

const EVAL_BLUEPRINT = new URL(
  "../releases/ui-build/eval-blueprint.ts",
  import.meta.url,
).pathname;
const LIMIT_MS = 10_000;

function failed(...errors: string[]): Result<BlueprintCheckOutput> {
  return ok({ errors, warnings: [], permission_review: [] });
}

async function importsOf(source: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(`${source}/deno.json`));
    return parsed.imports ?? {};
  } catch {
    return {};
  }
}

export function checkBlueprint(deps: BlueprintCheckDeps): MemoryHandler {
  return async (ctx, raw) => {
    const { app } = raw as { app: string };
    const source = await deps.sourceRootOf(ctx, app);
    if (!source.ok) return source;
    const blueprintPath = `${source.value}/blueprint.ts`;
    try {
      await Deno.stat(blueprintPath);
    } catch {
      return failed("blueprint.ts is missing in the app source");
    }
    const sdkRoot = `${deps.dataRoot}/sdk`;
    const temp = await Deno.makeTempDir({ prefix: "blueprint-check-" });
    try {
      const mapPath = `${temp}/import-map.json`;
      await Deno.writeTextFile(
        mapPath,
        JSON.stringify(
          devImportMap(await importsOf(source.value), sdkRoot, source.value),
        ),
      );
      let output: Deno.CommandOutput;
      try {
        output = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--no-prompt",
            "--no-config",
            `--import-map=${mapPath}`,
            `--allow-read=${source.value},${sdkRoot}`,
            EVAL_BLUEPRINT,
            blueprintPath,
          ],
          cwd: source.value,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          signal: AbortSignal.timeout(LIMIT_MS),
        }).output();
      } catch {
        return err({
          code: "unavailable",
          message: "blueprint evaluation did not finish",
        });
      }
      if (output.code !== 0) {
        const reason = new TextDecoder().decode(output.stderr).trim()
          .split("\n").find((line) => line.trim() !== "") ?? "failed";
        return failed(`blueprint.ts could not be evaluated: ${reason}`);
      }
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(output.stdout));
      } catch {
        return failed("blueprint.ts default export is not JSON");
      }
      const checked = validateBlueprint(value, { app });
      if (!checked.ok) return failed(checked.error.message);
      return ok({
        errors: [],
        warnings: descriptionGaps(checked.value).map((gap) =>
          `description is empty: ${gap}`
        ),
        permission_review: checked.value.permissions,
      });
    } finally {
      await Deno.remove(temp, { recursive: true }).catch(() => {});
    }
  };
}
