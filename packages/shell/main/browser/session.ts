// 인터넷 탭의 persistent session 정책. browser profile마다 partition이 하나이고 정책은 partition마다 한 번 깐다.
// permission은 기본 거절(clipboard write만 허락), download는 사용자 입력 직후만, UA에서는 Electron token을 뺀다
// (앱 이름은 남긴다, user-agent.ts). 이 session은 browser 탭만 쓰므로 onBeforeSendHeaders도 여기서 한 번만 단다.
import { browserPartition } from "../../../protocol/shell/browser-profiles.ts";
import { decidePermission } from "./permission.ts";
import { browserUserAgent } from "./user-agent.ts";

/**
 * 알려진 browser partition: 기본 profile과 core의 profile 목록(아직 읽지 못했으면 없는 것)의 profile들.
 */
export function knownBrowserPartitions(
  profiles: readonly { id: string }[] | undefined,
): ReadonlySet<string> {
  return new Set([
    browserPartition(null),
    ...(profiles ?? []).map((profile) => browserPartition(profile.id)),
  ]);
}

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
      /** 이 download가 끝나거나 멈추면 부른다. */
      onEnd: (done: () => void) => void,
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
    /** 한 contents의 download가 처음 시작될 때(true)와 마지막이 끝났을 때(false). */
    downloading?(contentsId: number, active: boolean): void;
  },
): { clearData(): Promise<void> } {
  handle.onPermissionRequest(decidePermission);
  handle.onPermissionCheck(decidePermission);
  handle.denyDevices();

  // 시작한 contents를 모르면 사용자 입력을 확인할 수 없으니 거절한다.
  // 거절하지 않은 download는 저장 경로를 정하지 않아 Electron이 저장 dialog를 띄운다.
  const active = new Map<number, number>();
  handle.onDownload((event, contentsId, onEnd) => {
    if (contentsId === undefined || !deps.activation.fresh(contentsId)) {
      event.preventDefault();
      return;
    }
    const count = (active.get(contentsId) ?? 0) + 1;
    active.set(contentsId, count);
    if (count === 1) deps.downloading?.(contentsId, true);
    onEnd(() => {
      const left = (active.get(contentsId) ?? 1) - 1;
      if (left > 0) {
        active.set(contentsId, left);
        return;
      }
      active.delete(contentsId);
      deps.downloading?.(contentsId, false);
    });
  });

  handle.setUserAgent(browserUserAgent(handle.getUserAgent()));
  handle.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const original = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "user-agent",
    );
    if (original !== undefined) {
      setHeader(headers, "User-Agent", browserUserAgent(original[1]));
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
