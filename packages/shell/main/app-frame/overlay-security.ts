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
  /** `shellPermission`만 허락하고 나머지 permission과 device는 거절한다. */
  restrictPermissions(): void;
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

// default session에 뜨는 page는 shell 자신(lophn-shell://의 desktop 창과 overlay)뿐이다. 그 main frame의
// clipboard 쓰기(Copy Path, code 복사)만 허락한다. clipboard 읽기와 나머지는 모두 거절한다.
export function shellPermission(input: {
  permission: string;
  requestingUrl: string;
  isMainFrame: boolean;
}): boolean {
  if (input.permission !== "clipboard-sanitized-write" || !input.isMainFrame) {
    return false;
  }
  try {
    return new URL(input.requestingUrl).protocol === "lophn-shell:";
  } catch {
    return false;
  }
}

// factory 수명의 session 정책을 한 번만 설치한다. default session도 shellPermission 밖은 거절이다.
export function overlaySecurityFactory() {
  const sessions = new Map<OverlaySecuritySession, () => void>();
  return {
    session(session: OverlaySecuritySession) {
      if (sessions.has(session)) return;
      session.restrictPermissions();
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
