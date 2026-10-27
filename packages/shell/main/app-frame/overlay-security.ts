interface Preventable {
  preventDefault(): void;
}
interface Navigation extends Preventable {
  url: string;
  isMainFrame: boolean;
}
interface OverlaySecurityContents {
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
  onNavigation(listener: (event: Navigation) => void): () => void;
  onWebview(listener: (event: Preventable) => void): () => void;
  onDevtools(listener: () => void): () => void;
  closeDevTools(): void;
}
export interface OverlaySecuritySession {
  denyPermissions(): void;
  onDownload(listener: (event: Preventable) => void): () => void;
}
function overlayTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "lophn-shell:" &&
      parsed.host === "overlay" &&
      parsed.pathname === "/index.html" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search
    );
  } catch {
    return false;
  }
}

// factory 수명의 session 정책을 한 번만 설치한다. default session도 기본 deny다.
export function overlaySecurityFactory() {
  const sessions = new Map<OverlaySecuritySession, () => void>();
  return {
    session(session: OverlaySecuritySession) {
      if (sessions.has(session)) return;
      session.denyPermissions();
      sessions.set(
        session,
        session.onDownload((event) => event.preventDefault()),
      );
    },
    contents(contents: OverlaySecurityContents, packaged: boolean) {
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      const releases = [
        contents.onNavigation((event) => {
          if (!event.isMainFrame || !overlayTarget(event.url)) {
            event.preventDefault();
          }
        }),
        contents.onWebview((event) => event.preventDefault()),
      ];
      if (packaged) {
        releases.push(contents.onDevtools(() => contents.closeDevTools()));
      }
      return () => {
        for (const release of releases) release();
      };
    },
    dispose() {
      for (const release of sessions.values()) release();
      sessions.clear();
    },
  };
}
