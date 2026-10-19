// 봉한 artifact partition의 정책. 세 겹 장벽: scheme 안에서만 읽기(handleProtocol), 응답 CSP(serve.ts),
// 죽은 proxy(전송 차단). CSP는 약속이고 죽은 proxy는 실제 차단이라, proxy가 안 먹으면 봉하지 못한 것으로 보고 던진다.
export const ARTIFACT_SCHEME = "lophn-artifact";
export const ARTIFACT_PARTITION = "persist:lophn-artifact";

const DEAD_PROXY = "http://255.255.255.255:9";

/** Electron session에서 이 모듈이 쓰는 것만. */
export interface ArtifactSessionHandle {
  /** permission request·check·device handler를 모두 거절로 둔다. */
  denyPermissions(): void;
  onDownload(listener: (event: { preventDefault(): void }) => void): void;
  setProxy(rules: string): Promise<void>;
  /** 요청이 성공하면 true. */
  probe(url: string): Promise<boolean>;
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
  if (await handle.probe("https://127.0.0.1/")) {
    throw new Error("artifact partition could not be network-sealed");
  }
  handle.handleProtocol(ARTIFACT_SCHEME, serve);
}
