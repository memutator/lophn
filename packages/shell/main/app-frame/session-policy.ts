// 문서·앱 view의 session 정책은 이 모듈에만 등록한다. 여러 handler가
// 덮어쓰지 않게 한 session마다 한 번 설치하고, 같은 session을 두 번 주지 않는다.
import {
  type AppProtocolDeps,
  createAppProtocolHandler,
  VIEW_HEADER,
} from "./app-protocol.ts";
import {
  APP_SCHEME,
  type FetchHost,
  ownAppUrl,
  requestAllowed,
  type RequestKind,
} from "./network-policy.ts";

export interface DocumentSessionPolicy {
  /** session이 있을 수 있는 주소. 다른 대상으로 바뀌지 않게 해석한다. */
  allowedScheme: string;
  allowedHost: string | null;
  /** 다른 대상 요청·외부 network를 session에서 차단한다. */
  blockRequests(): void;
  clearStorageData(): Promise<void>;
}

export interface DocumentSessionRegistryInput {
  session: DocumentSessionPolicy;
  partition: string;
}

export const DOCUMENT_SCHEME = "lophn-document";

export interface DocumentSessionEntry {
  partition: string;
  policy: DocumentSessionPolicy;
}

/**
 * partition과 session을 묶어 기억한다. 닫을 때는 같은 entry로 clearStorageData를
 * 부르고 entry를 지운다.
 */
export function createDocumentSessions() {
  const entries = new Map<string, DocumentSessionEntry>();
  return {
    register({ session, partition }: DocumentSessionRegistryInput): void {
      if (entries.has(partition)) {
        throw new Error(`document session already registered: ${partition}`);
      }
      entries.set(partition, { partition, policy: session });
    },
    find(partition: string): DocumentSessionEntry | undefined {
      return entries.get(partition);
    },
    /** 닫힌 문서 view의 저장 상태를 지우고 registry에서 지운다. */
    async close(partition: string): Promise<void> {
      const entry = entries.get(partition);
      if (!entry) return;
      entries.delete(partition);
      await entry.policy.clearStorageData();
    },
  };
}

// ── 앱 session ──────────────────────────────────────────────────────────────
// 운영 앱은 `persist:app-<app>:live`, preview는 `persist:app-<app>:preview-<bundle hash>`다.
// 같은 앱·모드 view는 partition을 함께 쓰고, 다른 앱·preview·문서·shell과는 cookie·
// localStorage·IndexedDB·cache를 나누지 않는다(shell/app-frame#R1, R8). webRequest listener는
// session마다 하나라서 network 판정·view header·protocol handler를 여기서 한 번만 단다.

export function appPartition(
  app: string,
  mode: "live" | "preview",
  bundleHash: string,
): string {
  return mode === "live"
    ? `persist:app-${app}:live`
    : `persist:app-${app}:preview-${bundleHash}`;
}

/** `app_<ULID>` → `app-<ULID 소문자>`. custom scheme host는 소문자 DNS label이다(R11). */
export function appHostLabel(app: string): string {
  return `app-${app.slice("app_".length).toLowerCase()}`;
}

export interface Preventable {
  preventDefault(): void;
}

export interface RequestDetails {
  url: string;
  resourceType: string;
  webContentsId?: number;
}

export interface HeaderDetails extends RequestDetails {
  requestHeaders: Record<string, string>;
}

/** Electron session에서 이 모듈이 쓰는 것만. */
export interface AppSessionHandle {
  denyPermissions(): void;
  onDownload(listener: (event: Preventable) => void): void;
  onBeforeRequest(
    listener: (
      details: RequestDetails,
      callback: (response: { cancel: boolean }) => void,
    ) => void,
  ): void;
  onBeforeSendHeaders(
    listener: (
      details: HeaderDetails,
      callback: (response: { requestHeaders: Record<string, string> }) => void,
    ) => void,
  ): void;
  handleProtocol(
    scheme: string,
    handler: (request: Request) => Promise<Response>,
  ): void;
  /** HTTP cache와 code cache를 지운다. 앱 저장 상태(localStorage 등)는 남긴다. */
  clearCache(): Promise<void>;
}

/** webContents 하나가 지금 묶인 view. registry가 정한 값이다. */
export interface SessionView {
  token: string;
  appLabel: string;
  hosts: readonly FetchHost[];
}

export interface AppSessionsDeps {
  handle(partition: string): AppSessionHandle;
  /** webContents id → 지금 view. 폐기된 contents는 undefined다. */
  viewOf(contentsId: number | undefined): SessionView | undefined;
  protocol: AppProtocolDeps;
  platformPorts(): readonly number[];
}

function requestKind(resourceType: string): RequestKind {
  return resourceType === "mainFrame"
    ? "mainFrame"
    : resourceType === "subFrame"
    ? "subFrame"
    : "other";
}

function ownUrl(url: string, appLabel: string): boolean {
  try {
    return ownAppUrl(new URL(url), appLabel);
  } catch {
    return false;
  }
}

export function createAppSessions(deps: AppSessionsDeps) {
  const installed = new Map<
    string,
    { appLabel: string; handle: AppSessionHandle }
  >();
  return {
    /** partition의 정책을 한 번만 설치한다. 같은 partition에 다른 앱을 주지 않는다. */
    ensure(partition: string, appLabel: string): void {
      const existing = installed.get(partition);
      if (existing !== undefined) {
        if (existing.appLabel !== appLabel) {
          throw new Error(`app session bound to another app: ${partition}`);
        }
        return;
      }
      const handle = deps.handle(partition);
      handle.denyPermissions();
      handle.onDownload((event) => event.preventDefault());
      // 지금 view에 묶이지 않은 contents(폐기·교체된 view, worker 등)는 아무 데도 못 간다.
      handle.onBeforeRequest((details, callback) => {
        const view = deps.viewOf(details.webContentsId);
        const allowed = view !== undefined && view.appLabel === appLabel &&
          requestAllowed({
            url: details.url,
            kind: requestKind(details.resourceType),
            appLabel,
            hosts: view.hosts,
            platformPorts: deps.platformPorts(),
          });
        callback({ cancel: !allowed });
      });
      handle.onBeforeSendHeaders((details, callback) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(details.requestHeaders)) {
          // 페이지가 보낸 같은 이름의 header는 지운다. 값은 main만 정한다.
          if (name.toLowerCase() !== VIEW_HEADER) headers[name] = value;
        }
        const view = deps.viewOf(details.webContentsId);
        if (
          view !== undefined && view.appLabel === appLabel &&
          ownUrl(details.url, appLabel)
        ) {
          headers[VIEW_HEADER] = view.token;
        }
        callback({ requestHeaders: headers });
      });
      handle.handleProtocol(
        APP_SCHEME,
        createAppProtocolHandler(deps.protocol, appLabel),
      );
      installed.set(partition, { appLabel, handle });
    },
    /** release·연결·권한이 바뀐 partition의 cache를 지운다. 없는 partition은 아무것도 안 한다. */
    async clearCache(partition: string): Promise<void> {
      await installed.get(partition)?.handle.clearCache();
    },
  };
}

export type AppSessions = ReturnType<typeof createAppSessions>;
