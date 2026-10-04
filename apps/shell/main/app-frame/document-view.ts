// 격리 문서 view의 session 정책, 자원 proxy, 닫힘 정리를 여기서 한다.
// 이 view는 원본 파일 수정 통로가 없고 preload도 없다.
import {
  createDocumentHandler,
  documentHostLabelFor,
} from "./document-protocol.ts";
import { DOCUMENT_SCHEME } from "./session-policy.ts";

/** main이 registry에서 해석한 고정 version이다. 페이지 주장은 쓰지 않는다. */
export interface ResolvedDocumentVersion {
  files: readonly {
    path: string;
    media_type: string;
    primary: boolean;
  }[];
  /** blob contract의 고정 version 자원 읽기. 없는 path는 null이다. */
  read(path: string): Promise<Uint8Array | null>;
}

/** version ID → 고정 판. 없는 version은 null이다. */
export type DocumentVersionResolver = (
  versionId: string,
) => Promise<ResolvedDocumentVersion | null>;

export interface DocumentViewContents {
  close(): void;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
}

export interface DocumentSessionLike {
  setPermissionRequestHandler(
    handler: (
      contents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: () => boolean): void;
  setDevicePermissionHandler(handler: () => boolean): void;
  /** session의 저장 상태를 지운다. 문서 view를 닫을 때 부른다. */
  clearStorageData(): Promise<void>;
}

export const DOCUMENT_VIEW_SCHEME = DOCUMENT_SCHEME;

/** 격리 문서 view의 partition 이름. version과 view_session에 묶인다. */
export function documentViewPartition(
  versionId: string,
  viewSession: string,
): string {
  return `document-${versionId}-${viewSession}`;
}

/**
 * 이 view의 URL 하나. 소문자 DNS label host에 고정 version path를 붙인다.
 */
export function documentViewUrl(versionId: string, path: string): string {
  return `lophn-document://${documentHostLabelFor(versionId)}/${path}`;
}

/**
 * 문서 view 하나를 만든다. view 주소는 고정 판의 primary 파일로 정하고, 자원
 * 요청은 document protocol이 blob contract의 고정 version 자원만 내준다. 닫으면
 * webContents를 파괴하고 session 저장 상태를 지운다.
 */
export function openDocumentView(input: {
  versionId: string;
  viewSession: string;
  contents: DocumentViewContents;
  session: DocumentSessionLike;
  /** 모든 요청을 session에서 기본 차단한다(자기 view 주소는 protocol이 좁힌다). */
  blockRequests(): void;
  resolveVersion: DocumentVersionResolver;
}): {
  handle(request: { method: string; url: string }): Promise<
    { status: number; headers: Record<string, string>; body: Uint8Array | null }
  >;
  ready: Promise<string>;
  partition: string;
  close(): Promise<void>;
} {
  const partition = documentViewPartition(input.versionId, input.viewSession);
  input.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  input.session.setPermissionCheckHandler(() => false);
  input.session.setDevicePermissionHandler(() => false);
  input.blockRequests();
  let version: ResolvedDocumentVersion | null = null;
  const ready = input.resolveVersion(input.versionId).then((resolved) => {
    version = resolved;
    const path = resolved?.files.find((file) => file.primary)?.path;
    const url = path === undefined
      ? documentViewUrl(input.versionId, "")
      : documentViewUrl(input.versionId, path);
    return input.contents.loadURL(url).then(() => url);
  });
  // load 실패는 view 실패 경로(Controller)가 다룬다. 여기서 무시하지 않는다.
  void ready.catch(() => {});
  // 자원 요청은 blob contract의 고정 version만 내준다. worker(subframe·worker
  // script) 요청도 같은 경계를 거친다.
  const handler = createDocumentHandler(
    input.versionId,
    (path) => version === null ? Promise.resolve(null) : version.read(path),
    (path) => version?.files.find((file) => file.path === path)?.media_type,
  );
  return {
    handle: handler,
    ready,
    partition,
    async close() {
      if (!input.contents.isDestroyed()) input.contents.close();
      await input.session.clearStorageData();
    },
  };
}

export { documentHostLabelFor };
