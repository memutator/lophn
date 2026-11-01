// `declaration.check`. 앱 source의 현재 lophn.ts를 release 준비와 같은 방식(Node)으로 평가하고
// 구조 검사와 설명 빈 칸을 본다. release를 만들지 않는다.
// 평가는 앱 폴더에서 그 폴더의 node_modules로 돈다. SDK는 앱이 `npm install`로 건 `.lophn/sdk` 사본이
// `node_modules/@lophn/*`에서 풀린다.
import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../base/mod.ts";
import { validateDeclaration } from "../../../protocol/apps/declaration/mod.ts";
import type { DeclarationCheckOutput } from "../../../protocol/apps/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { nodeCommand } from "../../supervision/security/node-command.ts";
import { descriptionGaps } from "./describe.ts";

type DeclarationCheckDeps = {
  // 호출자가 그 앱을 열 수 있는지 보고 연결된 source 폴더를 돌려준다. 범위 밖이면 err다.
  sourceRootOf: (
    ctx: Parameters<MemoryHandler>[0],
    app: string,
  ) => Promise<Result<string>>;
  // 그 앱의 active domain 이름. 선언 command의 domain은 이 안에 있어야 한다.
  domainNamesOf: (app: string) => Promise<Result<string[]>>;
};

const EVAL_DECLARATION = fileURLToPath(
  new URL("../releases/ui-build/eval-declaration.ts", import.meta.url),
);
const LIMIT_MS = 10_000;

function failed(...errors: string[]): Result<DeclarationCheckOutput> {
  return ok({ errors, warnings: [], permission_review: [] });
}

async function resolved(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

// 평가는 source의 node_modules로 돌고 release 준비는 HEAD의 package.json으로 새로 깐다. source가 agent 밖
// (git pull, coding agent)에서 바뀌면 node_modules는 옛 SDK 판에 남아, 맞는 lophn.ts가 선언 오류로 보인다.
// package.json이 거는 SDK 사본과 node_modules가 실제로 가리키는 곳을 대어 다른 것을 돌려준다.
async function staleSdk(source: string): Promise<string[]> {
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(await readFile(`${source}/package.json`, "utf8"));
  } catch {
    return [];
  }
  const stale: string[] = [];
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, value] of Object.entries(deps)) {
    if (!value.startsWith("file:.lophn/sdk/")) continue;
    const want = value.slice("file:".length);
    const has = await resolved(`${source}/node_modules/${name}`);
    if (has !== undefined && has === (await resolved(`${source}/${want}`))) {
      continue;
    }
    stale.push(
      `${name} wants ${want}, node_modules has ${has === undefined ? "nothing" : relative(source, has)}`,
    );
  }
  return stale;
}

// 선언 평가 자식은 앱 source의 lophn.ts를 import하므로 lophn 자신의 process가 아니다. 앱 process와
// 같은 최소 환경만 주고, 기한이 넘으면 signal이 자식을 끝낸다.
function evaluate(
  declarationPath: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const launch = nodeCommand(EVAL_DECLARATION, [declarationPath]);
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...launch.env,
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      },
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

// Node의 실패 stderr는 `file://…:줄`·code·stack 순서라 첫 줄이면 원인이 아니라 위치만 남는다.
// 원인 줄(Error: …)을 고르고, 없을 때만 첫 줄을 쓴다.
function failureLine(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    lines.find((line) =>
      /^(?:Uncaught\s+)?[A-Za-z]*Error(?:\s*\[[^\]]*\])?:/.test(line),
    ) ??
    lines[0] ??
    "failed"
  );
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
    const stale = await staleSdk(source.value);
    if (stale.length > 0) {
      return failed(
        `the app source's node_modules does not match package.json (${stale.join("; ")}): run npm install in the app source folder, then check again`,
      );
    }
    let output: { code: number | null; stdout: string; stderr: string };
    try {
      output = await evaluate(declarationPath, source.value);
    } catch {
      return err({
        code: "unavailable",
        message: "declaration evaluation did not finish",
      });
    }
    if (output.code !== 0) {
      return failed(
        `lophn.ts could not be evaluated: ${failureLine(output.stderr)}`,
      );
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
  };
}
