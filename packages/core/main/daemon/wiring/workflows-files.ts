import { readdir, readFile, stat } from "node:fs/promises";
import { err, errorCode, ok } from "../../../../base/mod.ts";
import {
  WORKFLOW_ARTIFACT_ENTRY,
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  workflowArtifactFolder,
  workflowFolder,
  workflowNameSchema,
  workflowsFolder,
} from "../../../../protocol/workflows/mod.ts";
import type {
  DefinitionFile,
  WorkflowFiles,
} from "../../../workflows/ports.ts";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readDeclaration(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

// 읽기만 한다. symlink 폴더는 isDirectory()가 거짓이라 data root 밖을 가리키는 폴더가 빠진다.
export function createWorkflowFiles(dataRoot: string): WorkflowFiles {
  return {
    async list(project) {
      const names: string[] = [];
      try {
        for (
          const e of await readdir(workflowsFolder(dataRoot, project), {
            withFileTypes: true,
          })
        ) {
          if (e.isDirectory() && workflowNameSchema.safeParse(e.name).success) {
            names.push(e.name);
          }
        }
      } catch (e) {
        if (errorCode(e) !== "ENOENT") {
          return err({
            code: "unavailable",
            message: "workflows folder could not be read",
          });
        }
      }
      names.sort();
      const files: DefinitionFile[] = [];
      for (const name of names) {
        const entry = (view: "static" | "instance") =>
          isFile(
            `${
              workflowArtifactFolder(dataRoot, project, name, view)
            }/${WORKFLOW_ARTIFACT_ENTRY}`,
          );
        files.push({
          name,
          declaration: await readDeclaration(
            `${
              workflowFolder(dataRoot, project, name)
            }/${WORKFLOW_DECLARATION_FILE}`,
          ),
          flow: await isFile(
            `${workflowFolder(dataRoot, project, name)}/${WORKFLOW_FLOW_FILE}`,
          ),
          artifacts: {
            static: await entry("static"),
            instance: await entry("instance"),
          },
        });
      }
      return ok(files);
    },
  };
}
