import { projectIdSchema } from "../projects/values.ts";

// 앱 저장 자리 규칙. project 하나에 앱 하나라 앱의 자리는 project 아래에 있다.
// 값이 data root 밖으로 나가는 경로를 만들지 못하게 project id와 이어붙이는 조각의 모양을 검사해 던진다.
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function segment(value: string, what: string): string {
  if (!SEGMENT.test(value)) throw new Error(`invalid ${what}`);
  return value;
}

export function appFolder(dataRoot: string, project: string): string {
  if (!projectIdSchema.safeParse(project).success) {
    throw new Error("invalid project id");
  }
  return `${dataRoot}/projects/${project}/app`;
}

export function appDataFolder(dataRoot: string, project: string): string {
  return `${appFolder(dataRoot, project)}/data`;
}

export function appBundleCopy(
  dataRoot: string,
  project: string,
  bundleHash: string,
): string {
  return `${appFolder(dataRoot, project)}/bundles/${
    segment(bundleHash, "bundle hash")
  }`;
}

export function appStagingFolder(dataRoot: string, project: string): string {
  return `${appFolder(dataRoot, project)}/staging`;
}

export function appPreviewFolder(
  dataRoot: string,
  project: string,
  nonce: string,
): string {
  return `${appFolder(dataRoot, project)}/preview/${segment(nonce, "nonce")}`;
}

export function appDefaultSource(dataRoot: string, project: string): string {
  return `${appFolder(dataRoot, project)}/source`;
}
