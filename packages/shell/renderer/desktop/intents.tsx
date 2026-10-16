// main이 창 밖에서 온 일로 이 창에 시키는 것. 전역 팔레트 키는 지금 공간과
// 상관없이 Lophn Workspace 전체 팔레트를 열고(창 안 팔레트는 지금 공간의 행을 여닫는다),
// OS notification 클릭과 확인 요청 링크는 대기 목록을 연다. [Report a problem]의
// [View issue]는 그 앱 공간을 연다.
import { useEffect, useRef } from "react";

import type { IntentApi } from "../../ipc/shortcuts.ts";
import { useWaitingPanel } from "./connection/waiting/waiting-layer.tsx";
import type { Catalog, LophnSource } from "./lophn-space/source.ts";
import { useGlobalPalette, usePaletteEnv } from "./palette/host.tsx";
import { lophnScope, type LophnTarget } from "./palette/lophn-scope.ts";

const EMPTY_CATALOG: Catalog = { projects: [], apps: [] };

interface DesktopIntentsProps {
  intents: IntentApi;
  /** 전역 팔레트의 프로젝트·앱 행. 없거나 읽지 못하면 그 묶음만 빈다. */
  lophn?: LophnSource;
  /** 접수된 feedback이 묶인 Issue. 그 앱 공간의 Issues 탭에서 그 문제를 고른 채 연다. */
  onIssue?(app: string, problem: string): void;
  /** 전역 팔레트에서 고른 대상으로 간다. */
  go(target: LophnTarget): void;
}

export function DesktopIntents(
  { intents, lophn, onIssue, go }: DesktopIntentsProps,
) {
  const openGlobal = useGlobalPalette();
  const env = usePaletteEnv();
  const { setOpen } = useWaitingPanel();
  const latest = useRef({ lophn, onIssue, go, openGlobal, env, setOpen });
  latest.current = { lophn, onIssue, go, openGlobal, env, setOpen };

  useEffect(
    () =>
      intents.subscribe((intent) => {
        const current = latest.current;
        if (typeof intent === "object" && intent.kind === "app-issue") {
          // 접수된 feedback이 묶인 Issue. 그 앱 공간의 Issues 탭에서 그 문제를 연다.
          if (current.onIssue) current.onIssue(intent.app, intent.problem);
          else current.go({ kind: "app", id: intent.app });
          return;
        }
        if (intent !== "global-palette") {
          current.setOpen(true);
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
