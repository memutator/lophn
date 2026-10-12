// main이 창 밖에서 온 일로 이 창에 시키는 것. 전역 팔레트 키는 지금 공간과
// 상관없이 lophn 전체 팔레트를 열고(창 안 팔레트는 지금 공간의 행을 여닫는다),
// OS notification 클릭은 things-to-confirm을 열 뿐 읽음·결정이 아니다.
// `lophn://things-to-confirm/<id>` 링크는 그 요청을 고른 things-to-confirm을 열고 confirmation
// window는 열지 않는다. [Report a problem]의 [View issue]는 그 앱 공간을 연다.
import { useEffect, useRef } from "react";

import type { IntentApi } from "../../ipc/shortcuts.ts";
import type { Catalog, LophnSource } from "./lophn-space/source.ts";
import { useGlobalPalette, usePaletteEnv } from "./palette/host.tsx";
import { lophnScope, type LophnTarget } from "./palette/lophn-scope.ts";

const EMPTY_CATALOG: Catalog = { projects: [], apps: [] };

export interface DesktopIntentsProps {
  intents: IntentApi;
  /** 전역 팔레트의 프로젝트·컨텍스트·앱 행. 없거나 읽지 못하면 그 묶음만 빈다. */
  lophn?: LophnSource;
  /** request가 있으면 그 요청을 고른 채 연다. */
  onThingsToConfirm(request?: string): void;
  /** `lophn://things-to-confirm/<cac|tkt|app id>` 링크(coding agent 회수·취소·생성). 그 대상의 화면으로 간다. */
  onCoding?(target: string): void;
  /** 접수된 feedback이 묶인 Issue. 그 앱 공간의 Issues 탭에서 그 문제를 고른 채 연다. */
  onIssue?(app: string, problem: string): void;
  /** 전역 팔레트에서 고른 대상으로 간다. */
  go(target: LophnTarget): void;
}

export function DesktopIntents(
  {
    intents,
    lophn,
    onThingsToConfirm,
    onCoding,
    onIssue,
    go,
  }: DesktopIntentsProps,
) {
  const openGlobal = useGlobalPalette();
  const env = usePaletteEnv();
  const latest = useRef({
    lophn,
    onThingsToConfirm,
    onCoding,
    onIssue,
    go,
    openGlobal,
    env,
  });
  latest.current = {
    lophn,
    onThingsToConfirm,
    onCoding,
    onIssue,
    go,
    openGlobal,
    env,
  };

  useEffect(
    () =>
      intents.subscribe((intent) => {
        const current = latest.current;
        if (intent === "things-to-confirm") {
          current.onThingsToConfirm();
          return;
        }
        if (typeof intent === "object") {
          if (intent.kind === "app-issue") {
            // 접수된 feedback이 묶인 Issue. 그 앱 공간의 Issues 탭에서 그 문제를 연다.
            if (current.onIssue) current.onIssue(intent.app, intent.problem);
            else current.go({ kind: "app", id: intent.app });
          } else if (intent.kind === "coding") {
            // 연결 회수·Task 취소·Task 생성 링크. 화면만 열고 결정 창은 사람이 누를 때 연다.
            if (current.onCoding) current.onCoding(intent.target);
            else current.onThingsToConfirm();
          } else current.onThingsToConfirm(intent.request);
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
