// ArtifactSessionHandle을 Electron의 artifact partition에 잇는다.
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
    setProxy: (rules) =>
      session.setProxy({ mode: "fixed_servers", proxyRules: rules }),
    async probe(url) {
      try {
        await session.fetch(url, {
          method: "HEAD",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        });
        return true;
      } catch {
        return false;
      }
    },
    handleProtocol: (scheme, handler) =>
      session.protocol.handle(scheme, handler),
  };
}
