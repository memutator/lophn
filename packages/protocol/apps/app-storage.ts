import { appIdSchema } from "../projects/values.ts";

// 앱 저장 자리 규칙. 앱의 자리는 `<data>/apps/<app>`이다.
// 값이 data root 밖으로 나가는 경로를 만들지 못하게 앱 id와 이어붙이는 조각의 모양을 검사해 던진다.
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function segment(value: string, what: string): string {
  if (!SEGMENT.test(value)) throw new Error(`invalid ${what}`);
  return value;
}

export function appFolder(dataRoot: string, app: string): string {
  if (!appIdSchema.safeParse(app).success) {
    throw new Error("invalid app id");
  }
  return `${dataRoot}/apps/${app}`;
}

export function appDataFolder(dataRoot: string, app: string): string {
  return `${appFolder(dataRoot, app)}/data`;
}

export function appBundleCopy(
  dataRoot: string,
  app: string,
  bundleHash: string,
): string {
  return `${appFolder(dataRoot, app)}/bundles/${
    segment(bundleHash, "bundle hash")
  }`;
}

export function appStagingFolder(dataRoot: string, app: string): string {
  return `${appFolder(dataRoot, app)}/staging`;
}

export function appPreviewFolder(
  dataRoot: string,
  app: string,
  nonce: string,
): string {
  return `${appFolder(dataRoot, app)}/preview/${segment(nonce, "nonce")}`;
}

export function appDefaultSource(dataRoot: string, app: string): string {
  return `${appFolder(dataRoot, app)}/source`;
}
