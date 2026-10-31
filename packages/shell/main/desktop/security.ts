// 모든 BrowserWindow·WebContentsView·<webview> guest에 같은 격리 기본값을 쓴다.
// 배포 sandbox 실패를 --no-sandbox로 우회하지 않는다.
import { ARTIFACT_SCHEME } from "../artifact/session.ts";

export const SHELL_SCHEME = "lophn-shell";

interface SchemePrivilege {
  scheme: string;
  privileges: { standard: boolean; secure: boolean; supportFetchAPI: boolean };
}

interface SchemeRegistry {
  registerSchemesAsPrivileged(schemes: SchemePrivilege[]): void;
}

// shell 설치 파일과 앱 화면. service worker·CORS 우회·CSP 우회 권한은 주지 않는다
// (앱 service worker가 옛 release의 byte를 대신 내주지 못하게 한다).
const VIEW_SCHEMES = [SHELL_SCHEME, "lophn-app", ARTIFACT_SCHEME];

/**
 * session을 만들기 전에 한 번. Electron은 이 호출을 한 번만 받으므로 두 scheme을 함께
 * secure·standard·fetch 지원으로 등록한다.
 */
export function registerViewSchemes(protocol: SchemeRegistry): void {
  protocol.registerSchemesAsPrivileged(
    VIEW_SCHEMES.map((scheme) => ({
      scheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    })),
  );
}

/** shell 문서·앱 화면·artifact 화면의 scheme인가. browser guest는 이 scheme의 주소를 열지 않는다. */
export function isViewScheme(value: string): boolean {
  try {
    return VIEW_SCHEMES.includes(new URL(value).protocol.replace(/:$/, ""));
  } catch {
    return false;
  }
}

/** 격리 기본값. 창과 view가 같은 값을 쓰도록 여기 하나만 둔다. */
export interface WebPreferences {
  sandbox: true;
  contextIsolation: true;
  webSecurity: true;
  nodeIntegration: false;
  nodeIntegrationInSubFrames: false;
  nodeIntegrationInWorker: false;
  // shell 창(window.ts)만 true다. browser 탭과 앱·artifact 화면의 <webview>를 그 창에서만 붙인다.
  webviewTag: boolean;
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
