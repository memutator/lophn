// 인터넷 page의 navigation 규칙. Electron 없는 순수 함수다. subresource 요청은 막지 않는다.
export type NavigationDecision =
  | { allow: true }
  | {
      allow: false;
      reason: "unparseable" | "scheme" | "credentials";
      /** OS로 넘길 수 있는 scheme(mailto, tel). 넘기는 쪽이 fresh activation을 요구한다. */
      external?: true;
    };

const SUBFRAME_SCHEMES = new Set(["data:", "blob:", "about:"]);

export function decideNavigation(input: {
  url: string;
  isMainFrame: boolean;
}): NavigationDecision {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { allow: false, reason: "unparseable" };
  }
  const { protocol } = url;
  if (protocol === "http:" || protocol === "https:") {
    // userinfo는 피싱에 쓰이는 모양이라 최상위에서만 거절한다.
    if (input.isMainFrame && (url.username !== "" || url.password !== "")) {
      return { allow: false, reason: "credentials" };
    }
    return { allow: true };
  }
  if (input.isMainFrame) {
    if (input.url === "about:blank") return { allow: true };
    if (protocol === "mailto:" || protocol === "tel:") {
      // 제3자 iframe이 OS를 열지 못하도록 main frame에서만 표시한다.
      return { allow: false, reason: "scheme", external: true };
    }
    return { allow: false, reason: "scheme" };
  }
  if (SUBFRAME_SCHEMES.has(protocol)) return { allow: true };
  return { allow: false, reason: "scheme" };
}
