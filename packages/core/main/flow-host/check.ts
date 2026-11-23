// `workflow.check`. project workspace의 agent가 쓴 flow.ts를 실행하지 않고 type check만 한다. packageInstallPath를 쓰므로
// apps를 import하지 않는 workflows module이 아니라 core/main에 둔다(layers.md).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { isMap, parseDocument } from "yaml";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  FLOW_SDK_NAME,
  FLOW_SDK_VERSION,
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  workflowFolder,
} from "../../../protocol/workflows/mod.ts";
import { packageInstallPath } from "../../apps/packages/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import {
  type NodeCommand,
  nodeCommand,
} from "../../supervision/security/node-command.ts";
import { linkFlowSdk } from "./sdk-link.ts";

type CheckWorkflowDeps = {
  dataRoot: string;
  resolveProject: (ref: string) => Promise<Result<{ id: Id<"prj"> }>>;
};

// 첫 check는 lib 준비로 느릴 수 있다.
const LIMIT_MS = 30_000;
const MAX_ERRORS = 20;

// tsc는 `file(line,col): error TSxxxx: ...`를 stdout에 쓴다. 코드 발췌와 요약 줄은 버린다.
const ERROR_LINE = /^.+\(\d+,\d+\): error TS\d+: /;

function parseErrors(output: string): string[] {
  const errors = output
    .split("\n")
    .filter((line) => ERROR_LINE.test(line))
    .map((line) => line.trimEnd());
  if (errors.length === 0) {
    const first = output.split("\n").find((line) => line.trim() !== "");
    return [first?.trim() ?? "failed"];
  }
  return errors.length > MAX_ERRORS
    ? [
        ...errors.slice(0, MAX_ERRORS),
        `… and ${errors.length - MAX_ERRORS} more`,
      ]
    : errors;
}

// platform이 가진 typescript와 @types/node. 설치 사본에 없으면 check를 시작하지 못한다.
function compiler(): Result<{ command: NodeCommand; typeRoots: string }> {
  const require = createRequire(import.meta.url);
  try {
    const manifest = require.resolve("typescript/package.json");
    const types = require.resolve("@types/node/package.json");
    return ok({
      // bin/tsc는 이 process(ELECTRON_RUN_AS_NODE)의 Node로 돌린다. typescript의 bin은 exports에 없다.
      command: nodeCommand(join(dirname(manifest), "bin", "tsc")),
      typeRoots: dirname(dirname(types)),
    });
  } catch {
    return err({
      code: "unavailable",
      message: "workflow check needs typescript and @types/node",
    });
  }
}

// tsc의 결과를 모은다. spawn 실패는 거절한다. timeout도 결과로 돌려줘야 하므로
// AbortSignal 대신 SIGTERM을 보내고 close를 기다린다.
function runCheck(
  command: NodeCommand,
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args, ...args], {
      cwd,
      env: { ...process.env, ...command.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const decoder = new TextDecoder();
    let output = "";
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };
    // tsc는 자손이 없는 단일 process라 child.kill로 충분하다(Windows는 신호 구분 없이 끝낸다).
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* 이미 끝났다 */
      }
    }, LIMIT_MS);
    const collect = (chunk: Uint8Array) => {
      output += decoder.decode(chunk, { stream: true });
    };
    child.stdout!.on("data", collect);
    child.stderr!.on("data", collect);
    child.stdout!.on("error", () => {});
    child.stderr!.on("error", () => {});
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => {
      output += decoder.decode();
      finish(() => resolve({ code: code ?? 1, output }));
    });
  });
}

// check 통과 시 workflow.yaml의 주석·형식을 보존하며 flow_sdk 판 도장을 찍는다.
export async function stampFlowSdk(
  declarationPath: string,
  version: string,
): Promise<void> {
  let text: string;
  try {
    text = await readFile(declarationPath, "utf8");
  } catch {
    return;
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return;
  if (doc.get("flow_sdk") === version) return;
  doc.set("flow_sdk", version);
  await writeFile(declarationPath, doc.toString(), "utf8");
}

async function readInstalledFlowVersion(
  dataRoot: string,
  installPath: string,
): Promise<string> {
  try {
    const manifest = JSON.parse(
      await readFile(`${dataRoot}/${installPath}/package.json`, "utf8"),
    ) as { version?: unknown };
    if (
      typeof manifest.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(manifest.version)
    ) {
      return manifest.version;
    }
  } catch {
    // fallback to bundled constant
  }
  return FLOW_SDK_VERSION;
}

export function checkWorkflow(deps: CheckWorkflowDeps): MemoryHandler {
  return async (_ctx, raw) => {
    const [projectRef, name] = (raw as { workflow: string }).workflow.split(
      "/",
    );
    const project = await deps.resolveProject(projectRef!);
    if (!project.ok) return project;
    const folder = workflowFolder(deps.dataRoot, project.value.id, name!);
    const flowPath = `${folder}/${WORKFLOW_FLOW_FILE}`;
    try {
      await stat(flowPath);
    } catch {
      return ok({ errors: [`${WORKFLOW_FLOW_FILE} is missing`] });
    }
    const installed = packageInstallPath(FLOW_SDK_NAME, FLOW_SDK_VERSION);
    if (!installed.ok) return installed;
    const linked = await linkFlowSdk({
      dataRoot: deps.dataRoot,
      installPath: installed.value,
    });
    if (!linked.ok) return linked;
    const tool = compiler();
    if (!tool.ok) return tool;
    const temp = await mkdtemp(join(tmpdir(), "flow-check-"));
    try {
      const config = `${temp}/tsconfig.json`;
      await writeFile(
        config,
        JSON.stringify({
          compilerOptions: {
            target: "esnext",
            module: "esnext",
            moduleResolution: "bundler",
            lib: ["esnext"],
            types: ["node"],
            typeRoots: [tool.value.typeRoots],
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            allowImportingTsExtensions: true,
            // Node는 type만 지우고 실행한다. flow.ts가 실행 중에 깨질 문법을 check에서 잡는다.
            erasableSyntaxOnly: true,
          },
          files: [flowPath],
        }),
      );
      let result: { code: number; output: string };
      try {
        result = await runCheck(
          tool.value.command,
          ["--noEmit", "--pretty", "false", "-p", config],
          folder,
        );
      } catch {
        return err({
          code: "unavailable",
          message: "workflow check did not finish",
        });
      }
      if (result.code === 0) {
        const version = await readInstalledFlowVersion(
          deps.dataRoot,
          installed.value,
        );
        await stampFlowSdk(`${folder}/${WORKFLOW_DECLARATION_FILE}`, version);
        return ok({ errors: [] });
      }
      return ok({ errors: parseErrors(result.output) });
    } finally {
      await rm(temp, { recursive: true }).catch(() => {});
    }
  };
}
