// browser 탭의 <webview>를 붙이는 규칙. shell renderer가 적은 속성은 믿지 않는다: 붙이기 전에 main이
// partition을 보고, preload와 몰래 넣는 설정을 지우고, webPreferences를 hardened 값으로 덮고, 첫 주소를
// navigation 규칙에 지나게 한다. Electron 없는 순수 함수다.
import { normalizeAddress } from "./address.ts";
import { decideNavigation } from "./navigation.ts";
import { BROWSER_PARTITION } from "./session.ts";

/**
 * `will-attach-webview`의 `webPreferences`와 `params`를 고친다. false면 붙이지 않는다(preventDefault).
 * `base`는 guest가 쓸 webPreferences 전부다. renderer가 만든 값은 하나도 남기지 않는다.
 */
export function hardenWebviewAttach(input: {
  /** 붙이는 쪽이 project 창의 shell 문서인가. */
  fromShell: boolean;
  webPreferences: Record<string, unknown>;
  params: Record<string, string>;
  base: Record<string, unknown>;
}): boolean {
  const { webPreferences, params } = input;
  if (!input.fromShell || params.partition !== BROWSER_PARTITION) return false;
  for (const key of Object.keys(webPreferences)) delete webPreferences[key];
  Object.assign(webPreferences, input.base, {
    // Electron은 guest의 session을 이 칸에서 읽는다. 지우면 다른 session에 붙는다(실험으로 확인).
    partition: BROWSER_PARTITION,
    // popup이 setWindowOpenHandler(popup-host)에 닿아야 한다.
    disablePopups: false,
  });
  delete params.preload;
  delete params.webpreferences;
  delete params.disablewebsecurity;
  delete params.nodeintegration;
  delete params.nodeintegrationinsubframes;
  delete params.useragent;
  params.allowpopups = "on";
  if (params.src !== undefined && params.src !== "") {
    const address = normalizeAddress(params.src);
    params.src = address !== null &&
        decideNavigation({ url: address, isMainFrame: true }).allow
      ? address
      : "about:blank";
  }
  return true;
}

/** guest의 view_session. renderer는 `<webview>.getWebContentsId()`로 같은 이름을 만든다. */
export function guestViewSession(contentsId: number): string {
  return `wv-${contentsId}`;
}
