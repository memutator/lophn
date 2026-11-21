// shell renderer의 <webview> 붙이기 규칙. shell renderer가 적은 속성은 믿지 않는다: 붙이기 전에
// main이 붙이기의 종류(browser, app, artifact)에 맞는 partition을 강제하고(browser는 알려진 profile의 partition 하나), preload와 몰래 넣는
// 설정을 지우고, webPreferences를 hardened 값으로 덮는다. browser의 첫 주소는 navigation 규칙에
// 지나게 하고, app·artifact의 주소는 registry가 받아 준 그대로만 쓴다. Electron 없는 순수 함수다.
import type { WebContents } from "electron";

import { isViewScheme } from "../desktop/security.ts";
import { normalizeAddress } from "./address.ts";
import { decideNavigation } from "./navigation.ts";

export type WebviewKind = "browser" | "app" | "artifact";

/** 붙이기 하나가 쓸 값. renderer가 적은 partition·preload·주소는 이 값으로 덮는다. */
export interface WebviewTarget {
  kind: WebviewKind;
  /** guest가 쓸 session partition. */
  partition: string;
  /** app·artifact: renderer가 `<webview src>`에 적어야 하는 정확한 주소. browser는 null이다. */
  src: string | null;
  /** app·artifact가 강제할 preload. browser는 없다. */
  preload?: string;
}

/** 받아 둔 붙이기 하나. 창마다 하나인 FIFO가 did-attach 순서대로 bind한다. */
export interface AcceptedWebviewGuest {
  readonly target: WebviewTarget;
  /** 그 guest의 webContents에 hook과 view 신원을 건다. */
  bind(guest: WebContents): void;
  /** guest가 붙기 전에 창이 닫혔다. 받아 둔 값을 버린다. */
  drop(): void;
}

/**
 * app·artifact 영역이 자기 view의 붙이기를 풀어 주는 자리. 그 창의 view이고 그 src가 아직
 * 안 붙었을 때만 받는다(1회용). 아니면 undefined다.
 */
export type WebviewGuestResolver = (
  window: string,
  src: string,
) => AcceptedWebviewGuest | undefined;

/**
 * `will-attach-webview` 하나를 판정한다. 받으면 `webPreferences`·`params`를 고치고 그 target을
 * 돌려준다. 거절이면 undefined다(부르는 쪽이 preventDefault). `base`는 guest가 쓸 격리 기본값
 * 전부이고, renderer가 만든 값은 하나도 남기지 않는다.
 *
 * app·artifact 후보는 registry의 accept 결과다. 다른 창의 view·모르는 src·이미 쓴 src는
 * resolver가 undefined를 주므로 여기서는 거절로 보인다.
 */
export function hardenWebviewAttach(input: {
  /** 붙이는 쪽이 창의 shell 문서인가. */
  fromShell: boolean;
  webPreferences: Record<string, unknown>;
  params: Record<string, string>;
  app: WebviewTarget | undefined;
  artifact: WebviewTarget | undefined;
  /** 알려진 browser profile의 partition(`knownBrowserPartitions`). browser 붙이기는 이 가운데 하나만 받는다. */
  browserPartitions: ReadonlySet<string>;
  base: Record<string, unknown>;
}): WebviewTarget | undefined {
  const { params, webPreferences } = input;
  if (!input.fromShell) return undefined;
  // src가 맞는 app·artifact가 partition 속성보다 먼저다. app view에 browser partition을 적어
  // 다른 session으로 가려는 붙이기도 app 규칙(강제 partition·preload)으로 덮인다.
  const target =
    input.app !== undefined && input.app.src === params.src
      ? input.app
      : input.artifact !== undefined && input.artifact.src === params.src
        ? input.artifact
        : params.partition !== undefined &&
            input.browserPartitions.has(params.partition) &&
            !isViewScheme(params.src ?? "")
          ? {
              kind: "browser" as const,
              partition: params.partition,
              src: null,
            }
          : undefined;
  if (target === undefined) return undefined;
  for (const key of Object.keys(webPreferences)) delete webPreferences[key];
  Object.assign(
    webPreferences,
    input.base,
    {
      // Electron은 guest의 session을 이 칸에서 읽는다. 지우면 다른 session에 붙는다(실험으로 확인).
      partition: target.partition,
    },
    target.preload === undefined ? {} : { preload: target.preload },
  );
  delete params.preload;
  delete params.webpreferences;
  delete params.disablewebsecurity;
  delete params.nodeintegration;
  delete params.nodeintegrationinsubframes;
  delete params.useragent;
  delete params.allowpopups;
  params.partition = target.partition;
  if (target.kind === "browser") {
    // popup이 setWindowOpenHandler(popup-host)에 닿아야 한다. browser view만 DevTools를 쓴다.
    webPreferences.disablePopups = false;
    webPreferences.devTools = true;
    params.allowpopups = "on";
    if (params.src !== undefined && params.src !== "") {
      const address = normalizeAddress(params.src);
      params.src =
        address !== null &&
        decideNavigation({ url: address, isMainFrame: true }).allow
          ? address
          : "about:blank";
    }
    return target;
  }
  // app·artifact view는 새 창을 열지 않는다. 주소는 registry가 받아 준 그대로만 쓴다.
  webPreferences.disablePopups = true;
  params.src = target.src ?? "about:blank";
  return target;
}

/** guest의 view_session. renderer는 `<webview>.getWebContentsId()`로 같은 이름을 만든다. */
export function guestViewSession(contentsId: number): string {
  return `wv-${contentsId}`;
}
