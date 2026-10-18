// 인터넷 탭이 함께 쓰는 persistent session의 정책. permission은 기본 거절(clipboard write만 허락),
// download는 사용자 입력 직후만, UA에서는 Electron·앱 이름을 뺀다. 이 session은 browser 탭만 쓰므로
// onBeforeSendHeaders도 여기서 한 번만 단다.
import { decidePermission } from "./permission.ts";
import { clientHintHeaders, sanitizeUserAgent } from "./user-agent.ts";

export const BROWSER_PARTITION = "persist:lophn-browser";

interface PermissionInput {
  permission: string;
  requestingUrl: string;
  isMainFrame: boolean;
}

interface HeaderDetails {
  requestHeaders: Record<string, string>;
}

/** Electron session에서 이 모듈이 쓰는 것만. */
export interface BrowserSessionHandle {
  onPermissionRequest(decide: (input: PermissionInput) => boolean): void;
  onPermissionCheck(decide: (input: PermissionInput) => boolean): void;
  denyDevices(): void;
  /** `contentsId`는 download를 시작한 webContents다. 알 수 없으면 undefined. */
  onDownload(
    listener: (
      event: { preventDefault(): void },
      contentsId: number | undefined,
    ) => void,
  ): void;
  getUserAgent(): string;
  setUserAgent(userAgent: string): void;
  onBeforeSendHeaders(
    listener: (
      details: HeaderDetails,
      callback: (response: { requestHeaders: Record<string, string> }) => void,
    ) => void,
  ): void;
  /** 모든 종류의 storage를 지운다. */
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
}

/** 같은 이름의 header는 대소문자가 달라도 하나만 남긴다. */
function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
  headers[name] = value;
}

/** handle마다 한 번만 부른다. 두 번 설치하면 listener가 겹친다. */
export function installBrowserSession(
  handle: BrowserSessionHandle,
  deps: {
    activation: { fresh(contentsId: number): boolean };
    product: string;
    platform: string;
  },
): { clearData(): Promise<void> } {
  handle.onPermissionRequest(decidePermission);
  handle.onPermissionCheck(decidePermission);
  handle.denyDevices();

  // 시작한 contents를 모르면 사용자 입력을 확인할 수 없으니 거절한다.
  // 거절하지 않은 download는 저장 경로를 정하지 않아 Electron이 저장 dialog를 띄운다.
  handle.onDownload((event, contentsId) => {
    if (contentsId === undefined || !deps.activation.fresh(contentsId)) {
      event.preventDefault();
    }
  });

  handle.setUserAgent(
    sanitizeUserAgent(handle.getUserAgent(), deps.product),
  );
  handle.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const original = Object.entries(headers).find(([name]) =>
      name.toLowerCase() === "user-agent"
    );
    if (original !== undefined) {
      const userAgent = sanitizeUserAgent(original[1], deps.product);
      setHeader(headers, "User-Agent", userAgent);
      for (
        const [name, value] of Object.entries(
          clientHintHeaders(userAgent, deps.platform),
        )
      ) {
        setHeader(headers, name, value);
      }
    }
    callback({ requestHeaders: headers });
  });

  return {
    async clearData() {
      await handle.clearStorageData();
      await handle.clearCache();
    },
  };
}
