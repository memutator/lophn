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

// log는 어느 fs grant로도 열리지 않는 자리다. 쓰는 쪽은 app supervisor 하나다(app-log.ts).
export function appLogFolder(dataRoot: string, app: string): string {
  return `${appFolder(dataRoot, app)}/logs`;
}

export function appLogFile(dataRoot: string, app: string): string {
  return `${appLogFolder(dataRoot, app)}/app.log`;
}

// 돌린 앞 file. 하나만 둔다.
export function appLogPreviousFile(dataRoot: string, app: string): string {
  return `${appLogFolder(dataRoot, app)}/app.log.1`;
}

export function appBundleCopy(
  dataRoot: string,
  app: string,
  bundleHash: string,
): string {
  return `${appFolder(dataRoot, app)}/bundles/${segment(
    bundleHash,
    "bundle hash",
  )}`;
}

// 봉인된 bundle 사본들이 hardlink로 나눠 쓰는 file store. 앱 사이에도 나눠 쓴다. `<sha256>` 하나가 file 하나다.
export function bundleFileStore(dataRoot: string): string {
  return `${dataRoot}/bundle-files`;
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
