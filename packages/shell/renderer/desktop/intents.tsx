// main이 창 밖에서 온 일로 이 창에 시키는 것. 전역 팔레트 키는 지금 공간과
// 상관없이 project·앱 전체 팔레트를 연다(창 안 팔레트는 지금 공간의 행을 여닫는다).
import { useEffect, useRef } from "react";

import type { IntentApi } from "../../ipc/shortcuts.ts";
import type { SettingsPane } from "./settings/model.ts";
import type { Catalog, CatalogSource } from "./palette/catalog.ts";
import { useGlobalPalette, usePaletteEnv } from "./palette/host.tsx";
import { desktopScope, type DesktopTarget } from "./palette/desktop-scope.ts";

const EMPTY_CATALOG: Catalog = { projects: [], apps: [] };

interface DesktopIntentsProps {
  intents: IntentApi;
  /** 전역 팔레트의 프로젝트·앱 행. 없거나 읽지 못하면 그 묶음만 빈다. */
  catalog?: CatalogSource;
  /** 전역 팔레트에서 고른 대상으로 간다. */
  go(target: DesktopTarget): void;
  /** Settings의 그 항목을 연다. */
  onSettings(pane: SettingsPane): void;
}

export function DesktopIntents({
  intents,
  catalog,
  go,
  onSettings,
}: DesktopIntentsProps) {
  const openGlobal = useGlobalPalette();
  const env = usePaletteEnv();
  const latest = useRef({ catalog, go, openGlobal, env, onSettings });
  latest.current = { catalog, go, openGlobal, env, onSettings };

  useEffect(
    () =>
      intents.subscribe((intent) => {
        const current = latest.current;
        if (intent === "remote-settings") {
          current.onSettings("remote");
          return;
        }
        void (async () => {
          const loaded = current.catalog
            ? await current.catalog.catalog()
            : null;
          const { env, go, openGlobal } = latest.current;
          const search = env.search;
          openGlobal(
            desktopScope({
              catalog: loaded?.ok ? loaded.value : EMPTY_CATALOG,
              platform: env.platform,
              keys: env.keys(),
              search: search ? (query) => search(query, null) : undefined,
              go,
            }),
          );
        })();
      }),
    [intents],
  );
  return null;
}
