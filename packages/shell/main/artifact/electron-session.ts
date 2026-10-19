// ArtifactSessionHandle을 Electron의 artifact partition에 잇는다.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { session as electronSession } from "electron";

import { ARTIFACT_PARTITION, type ArtifactSessionHandle } from "./session.ts";

export function electronArtifactSession(): ArtifactSessionHandle {
  const session = electronSession.fromPartition(ARTIFACT_PARTITION);
  return {
    denyPermissions() {
      session.setPermissionRequestHandler((_contents, _permission, done) =>
        done(false)
      );
      session.setPermissionCheckHandler(() => false);
      session.setDevicePermissionHandler(() => false);
    },
    onDownload(listener) {
      session.on("will-download", (event) => listener(event));
    },
    // Chromium은 loopback을 proxy에서 암묵적으로 빼므로 "<-loopback>"으로 loopback도 죽은 proxy를 거치게 한다.
    // artifact partition은 자기 scheme만 열고 proxy는 그 scheme에 닿지 않는다.
    setProxy: (rules) =>
      session.setProxy({
        mode: "fixed_servers",
        proxyRules: rules,
        proxyBypassRules: "<-loopback>",
      }),
    // proxy가 안 먹으면 닿을 서버를 직접 띄워 친다. 아무도 없는 포트를 치면 proxy와 상관없이 실패해 아무것도 검증하지 못한다.
    async probe() {
      const server = createServer((_req, res) => {
        res.statusCode = 204;
        res.end();
      });
      // listen 실패는 던진다. false로 돌리면 아무것도 검증하지 않고 봉한 것으로 넘어간다.
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      try {
        await session.fetch(`http://127.0.0.1:${port}/`, {
          method: "HEAD",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        });
        return true;
      } catch {
        return false;
      } finally {
        server.close();
      }
    },
    handleProtocol: (scheme, handler) =>
      session.protocol.handle(scheme, handler),
  };
}
