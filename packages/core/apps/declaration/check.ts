// `declaration.check`. 앱 source의 현재 lophn.ts를 release 준비와 같은 방식(권한 좁은 Deno)으로 평가하고
// 구조 검사와 설명 빈 칸을 본다. release를 만들지 않는다.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "../../../base/mod.ts";
import { validateDeclaration } from "../../../protocol/apps/declaration/mod.ts";
import type { DeclarationCheckOutput } from "../../../protocol/apps/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { denoBinary } from "../../supervision/security/node-command.ts";
import { devImportMap } from "../packages/mod.ts";
import { descriptionGaps } from "./describe.ts";

type DeclarationCheckDeps = {
  dataRoot: string;
  // 호출자가 그 앱을 열 수 있는지 보고 연결된 source 폴더를 돌려준다. 범위 밖이면 err다.
  sourceRootOf: (
    ctx: Parameters<MemoryHandler>[0],
    app: string,
  ) => Promise<Result<string>>;
  // 그 앱의 active domain 이름. 선언 tool의 domain은 이 안에 있어야 한다.
  domainNamesOf: (app: string) => Promise<Result<string[]>>;
};

const EVAL_DECLARATION = new URL(
  "../releases/ui-build/eval-declaration.ts",
  import.meta.url,
).pathname;
const LIMIT_MS = 10_000;

function failed(...errors: string[]): Result<DeclarationCheckOutput> {
  return ok({ errors, warnings: [], permission_review: [] });
}

async function importsOf(source: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(`${source}/deno.json`, "utf8"));
    return parsed.imports ?? {};
  } catch {
    return {};
  }
}

// 선언 평가 자식은 앱 source의 lophn.ts를 import하므로 lophn 자신의 process가 아니다.
// 기한이 넘으면 signal이 자식을 끝낸다.
function evaluate(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(denoBinary(), [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(LIMIT_MS),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      }),
    );
  });
}

export function checkDeclaration(deps: DeclarationCheckDeps): MemoryHandler {
  return async (ctx, raw) => {
    const { app } = raw as { app: string };
    const source = await deps.sourceRootOf(ctx, app);
    if (!source.ok) return source;
    const declarationPath = `${source.value}/lophn.ts`;
    try {
      await stat(declarationPath);
    } catch {
      return failed("lophn.ts is missing in the app source");
    }
    const sdkRoot = `${deps.dataRoot}/sdk`;
    const temp = await mkdtemp(join(tmpdir(), "declaration-check-"));
    try {
      const mapPath = `${temp}/import-map.json`;
      await writeFile(
        mapPath,
        JSON.stringify(
          devImportMap(
            await importsOf(source.value),
            deps.dataRoot,
            source.value,
          ),
        ),
      );
      let output: { code: number | null; stdout: string; stderr: string };
      try {
        output = await evaluate(
          [
            "run",
            "--no-prompt",
            "--no-config",
            `--import-map=${mapPath}`,
            `--allow-read=${source.value},${sdkRoot}`,
            EVAL_DECLARATION,
            declarationPath,
          ],
          source.value,
        );
      } catch {
        return err({
          code: "unavailable",
          message: "declaration evaluation did not finish",
        });
      }
      if (output.code !== 0) {
        const reason =
          output.stderr
            .trim()
            .split("\n")
            .find((line) => line.trim() !== "") ?? "failed";
        return failed(`lophn.ts could not be evaluated: ${reason}`);
      }
      let value: unknown;
      try {
        value = JSON.parse(output.stdout);
      } catch {
        return failed("lophn.ts default export is not JSON");
      }
      const domains = await deps.domainNamesOf(app);
      if (!domains.ok) return domains;
      const checked = validateDeclaration(value, {
        app,
        domains: domains.value,
      });
      if (!checked.ok) return failed(checked.error.message);
      return ok({
        errors: [],
        warnings: descriptionGaps(checked.value).map(
          (gap) => `description is empty: ${gap}`,
        ),
        permission_review: checked.value.permissions,
      });
    } finally {
      await rm(temp, { recursive: true }).catch(() => {});
    }
  };
}
