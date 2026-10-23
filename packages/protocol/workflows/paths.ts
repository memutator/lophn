// workflow의 lophn data 자리. shell main이 import하므로 import를 두지 않는다.
// 자리는 `<data>/projects/<prj>/workflows/<name>/`이고 정의 file, workflow.md, artifact가 든다.
export const WORKFLOWS_FOLDER = "workflows";
export const WORKFLOW_DECLARATION_FILE = "workflow.yaml";
export const WORKFLOW_FLOW_FILE = "flow.ts";
export const WORKFLOW_DOC_FILE = "workflow.md";
export const WORKFLOW_ARTIFACT_ENTRY = "index.html";

export function workflowsFolder(dataRoot: string, project: string): string {
  return `${dataRoot}/projects/${project}/${WORKFLOWS_FOLDER}`;
}

export function workflowFolder(
  dataRoot: string,
  project: string,
  name: string,
): string {
  return `${workflowsFolder(dataRoot, project)}/${name}`;
}

export function workflowArtifactFolder(
  dataRoot: string,
  project: string,
  name: string,
  view: "static" | "instance",
): string {
  return `${workflowFolder(dataRoot, project, name)}/artifacts/${view}`;
}
