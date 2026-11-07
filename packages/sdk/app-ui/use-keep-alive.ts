import { useEffect, useId } from "react";

// 앱 view preload bridge `lophnApp`의 살려 두기 부분의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).

export interface KeepAliveBridge {
  setKeepAlive(active: boolean, key?: string): void;
}

function keepAliveBridge(): KeepAliveBridge | undefined {
  const app = (globalThis as { lophnApp?: Partial<KeepAliveBridge> }).lophnApp;
  return app?.setKeepAlive === undefined ? undefined : (app as KeepAliveBridge);
}

/**
 * active인 동안 사람이 이 화면이 있는 workspace를 떠나도 lophn이 page를 숨겨 살려 둔다(돌아오면 다시 load하지
 * 않는다). 일이 도는 동안(agent 답을 기다림, 업로드 중)만 켜고 끝나면 끈다. 화면이 사라지면 내려간다.
 * `useKeepAlive`를 쓰는 곳마다 따로 켜지는 key라 `@lophn/agent`의 자동 신호나 다른 hook과 서로 끄지 않는다.
 * 살려 두는 page는 창마다 6개까지이고 넘치면 오래 안 본 것부터 놓이므로 늘 켜 두지 않는다.
 */
export function useKeepAlive(
  active: boolean,
  app: KeepAliveBridge | undefined = keepAliveBridge(),
): void {
  const key = `app-ui:${useId()}`;
  useEffect(() => {
    if (app === undefined || !active) return;
    app.setKeepAlive(true, key);
    return () => app.setKeepAlive(false, key);
  }, [app, active, key]);
}
