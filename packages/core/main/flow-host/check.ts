// `workflow.check`. PM이 쓴 flow.ts를 실행하지 않고 type check만 한다. devImportMap을 쓰므로 apps를 import하지
// 않는 workflows module이 아니라 core/main에 둔다(layers.md).
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  FLOW_SDK_NAME,
  FLOW_SDK_VERSION,
  WORKFLOW_FLOW_FILE,
  workflowFolder,
} from "../../../protocol/workflows/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { devImportMap } from "../../apps/packages/mod.ts";

type CheckWorkflowDeps = {
  dataRoot: string;
  resolveProject: (ref: string) => Promise<Result<{ id: Id<"prj"> }>>;
};

// 첫 check는 lib 준비로 느릴 수 있다.
const LIMIT_MS = 30_000;
const MAX_ERRORS = 20;

const ERROR_START = /^(TS\d+ \[ERROR\]: |error: )/;
const AT_LINE = /^\s+at (file:\/\/\S+)/;

// 한 오류는 시작 줄과 그 블록의 첫 `at` 줄이다. 코드 발췌, `~~~`, 끝 "Type checking failed."는 버린다.
function parseErrors(stderr: string, folder: string): string[] {
  const errors: string[] = [];
  let open = -1;
  for (const line of stderr.split("\n")) {
    if (ERROR_START.test(line)) {
      if (line === "error: Type checking failed.") {
        open = -1;
        continue;
      }
      errors.push(line);
      open = errors.length - 1;
      continue;
    }
    const at = AT_LINE.exec(line);
    if (at !== null && open >= 0) {
      errors[open] += ` ${at[1]}`;
      open = -1;
    }
  }
  const cleaned = errors.map((e) => e.replaceAll(`file://${folder}/`, ""));
  if (cleaned.length === 0) {
    const first = stderr.split("\n").find((l) => l.trim() !== "");
    return [first?.trim() ?? "failed"];
  }
  return cleaned.length > MAX_ERRORS
    ? [
      ...cleaned.slice(0, MAX_ERRORS),
      `… and ${cleaned.length - MAX_ERRORS} more`,
    ]
    : cleaned;
}

export function checkWorkflow(deps: CheckWorkflowDeps): MemoryHandler {
  return async (_ctx, raw) => {
    const [projectRef, name] = (raw as { workflow: string }).workflow
      .split("/");
    const project = await deps.resolveProject(projectRef!);
    if (!project.ok) return project;
    const folder = workflowFolder(deps.dataRoot, project.value.id, name!);
    const flowPath = `${folder}/${WORKFLOW_FLOW_FILE}`;
    try {
      await Deno.stat(flowPath);
    } catch {
      return ok({ errors: [`${WORKFLOW_FLOW_FILE} is missing`] });
    }
    const temp = await Deno.makeTempDir({ prefix: "flow-check-" });
    try {
      const mapPath = `${temp}/import-map.json`;
      await Deno.writeTextFile(
        mapPath,
        JSON.stringify(
          devImportMap(
            {
              [FLOW_SDK_NAME]:
                `lophn-sdk:${FLOW_SDK_NAME}@${FLOW_SDK_VERSION}/mod.ts`,
            },
            deps.dataRoot,
            deps.dataRoot,
          ),
        ),
      );
      let output: Deno.CommandOutput;
      try {
        // deno check는 권한 flag를 받지 않는다. code를 실행하지 않으니 필요 없고, 원격·npm import와 config와
        // lock을 꺼서 SDK를 import map으로만 푼다.
        output = await new Deno.Command(Deno.execPath(), {
          args: [
            "check",
            "--no-config",
            "--no-remote",
            "--no-npm",
            "--cached-only",
            "--no-lock",
            `--import-map=${mapPath}`,
            flowPath,
          ],
          cwd: folder,
          env: { NO_COLOR: "1" },
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          signal: AbortSignal.timeout(LIMIT_MS),
        }).output();
      } catch {
        return err({
          code: "unavailable",
          message: "workflow check did not finish",
        });
      }
      if (output.code === 0) return ok({ errors: [] });
      return ok({
        errors: parseErrors(new TextDecoder().decode(output.stderr), folder),
      });
    } finally {
      await Deno.remove(temp, { recursive: true }).catch(() => {});
    }
  };
}
