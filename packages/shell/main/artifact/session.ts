// 봉한 artifact partition의 정책. 세 겹 장벽: scheme 안에서만 읽기(handleProtocol), 응답 CSP(serve.ts),
// 죽은 proxy(전송 차단). CSP는 약속이고 죽은 proxy는 실제 차단이라, proxy가 안 먹으면 봉하지 못한 것으로 보고 던진다.
// proxy는 loopback까지 거치게 해 두므로(electron-session.ts), proxy가 없으면 닿을 loopback 서버를 probe가 친다.
export const ARTIFACT_SCHEME = "lophn-artifact";
export const ARTIFACT_PARTITION = "persist:lophn-artifact";

const DEAD_PROXY = "http://255.255.255.255:9";

/** Electron session에서 이 모듈이 쓰는 것만. */
export interface ArtifactSessionHandle {
  /** permission request·check·device handler를 모두 거절로 둔다. */
  denyPermissions(): void;
  onDownload(listener: (event: { preventDefault(): void }) => void): void;
  setProxy(rules: string): Promise<void>;
  /** 이 session으로 닿을 loopback 서버를 쳐서, 응답이 오면(proxy가 안 먹으면) true. */
  probe(): Promise<boolean>;
  handleProtocol(
    scheme: string,
    handler: (request: Request) => Promise<Response>,
  ): void;
}

/** handle마다 한 번만 부른다. 두 번 부르면 download listener가 겹친다. */
export async function sealArtifactSession(
  handle: ArtifactSessionHandle,
  serve: (request: Request) => Promise<Response>,
): Promise<void> {
  handle.denyPermissions();
  handle.onDownload((event) => event.preventDefault());
  await handle.setProxy(DEAD_PROXY);
  if (await handle.probe()) {
    throw new Error("artifact partition could not be network-sealed");
  }
  handle.handleProtocol(ARTIFACT_SCHEME, serve);
}
