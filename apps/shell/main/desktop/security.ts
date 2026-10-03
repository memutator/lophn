// 모든 BrowserWindow·WebContentsView에 같은 격리 기본값을 쓴다.
// 배포 sandbox 실패를 --no-sandbox로 우회하지 않는다.

export const SHELL_SCHEME = "lophn-shell";

export interface SchemePrivilege {
  scheme: string;
  privileges: { standard: boolean; secure: boolean; supportFetchAPI: boolean };
}

export interface SchemeRegistry {
  registerSchemesAsPrivileged(schemes: SchemePrivilege[]): void;
}

/** session을 만들기 전에 한 번. shell scheme만 등록한다. */
export function registerShellScheme(protocol: SchemeRegistry): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SHELL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** 격리 기본값. 창과 view가 같은 값을 쓰도록 여기 하나만 둔다. */
export interface WebPreferences {
  sandbox: true;
  contextIsolation: true;
  webSecurity: true;
  nodeIntegration: false;
  nodeIntegrationInSubFrames: false;
  nodeIntegrationInWorker: false;
  webviewTag: false;
  allowRunningInsecureContent: false;
  devTools: boolean;
}

export function webPreferences(packaged: boolean): WebPreferences {
  return {
    sandbox: true,
    contextIsolation: true,
    webSecurity: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    devTools: !packaged,
  };
}

export interface PermissionContents {
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
  onPermissionRequest(handler: (permission: string) => boolean): void;
  onDevtoolsOpened(handler: () => void): void;
  closeDevTools(): void;
}

/**
 * 새 창과 camera·location 같은 권한 요청은 기본 거절한다.
 * packaged build에서는 devtools가 열려도 바로 닫는다.
 */
export function hardenContents(
  contents: PermissionContents,
  packaged: boolean,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.onPermissionRequest(() => false);
  if (packaged) {
    contents.onDevtoolsOpened(() => contents.closeDevTools());
  }
}
