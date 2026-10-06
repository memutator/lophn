// main이 창 밖에서 온 일로 이 창에 시키는 것(shell#T56). 전역 팔레트 키는 지금 공간과
// 상관없이 lophn 전체 팔레트를 열고(창 안 팔레트는 지금 공간의 행을 여닫는다, desktop#R18),
// OS notification 클릭은 things-to-confirm을 열 뿐 읽음·결정이 아니다(desktop#R10).
// `lophn://things-to-confirm/<id>` 링크는 그 요청을 고른 things-to-confirm을 열고 confirmation
// window는 열지 않는다(desktop#R14).
import { useEffect, useRef } from "react";

import type { IntentApi } from "../../ipc/shortcuts.ts";
import type { Catalog, LophnSource } from "./lophn-space/source.ts";
import { useGlobalPalette, usePaletteEnv } from "./palette/host.tsx";
import { lophnScope, type LophnTarget } from "./palette/lophn-scope.ts";

const EMPTY_CATALOG: Catalog = { projects: [], apps: [], contexts: [] };

export interface DesktopIntentsProps {
  intents: IntentApi;
  /** 전역 팔레트의 프로젝트·컨텍스트·앱 행. 없거나 읽지 못하면 그 묶음만 빈다. */
  lophn?: LophnSource;
  /** request가 있으면 그 요청을 고른 채 연다. */
  onThingsToConfirm(request?: string): void;
  /** 전역 팔레트에서 고른 대상으로 간다. */
  go(target: LophnTarget): void;
}

export function DesktopIntents(
  { intents, lophn, onThingsToConfirm, go }: DesktopIntentsProps,
) {
  const openGlobal = useGlobalPalette();
  const env = usePaletteEnv();
  const latest = useRef({ lophn, onThingsToConfirm, go, openGlobal, env });
  latest.current = { lophn, onThingsToConfirm, go, openGlobal, env };

  useEffect(
    () =>
      intents.subscribe((intent) => {
        const current = latest.current;
        if (intent === "things-to-confirm") {
          current.onThingsToConfirm();
          return;
        }
        if (typeof intent === "object") {
          current.onThingsToConfirm(intent.request);
          return;
        }
        void (async () => {
          const loaded = current.lophn ? await current.lophn.catalog() : null;
          const { env, go, openGlobal } = latest.current;
          const search = env.search;
          openGlobal(lophnScope({
            catalog: loaded?.ok ? loaded.value : EMPTY_CATALOG,
            platform: env.platform,
            search: search ? (query) => search(query, null) : undefined,
            go,
          }));
        })();
      }),
    [intents],
  );
  return null;
}
