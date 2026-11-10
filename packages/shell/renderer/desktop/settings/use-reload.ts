// settings의 각 자리는 처음 열 때, core가 (다시) 준비될 때, 창이 다시 focus를 받을 때, core의 설정이 바뀔 때
// 현재 값을 읽는다. 보호 창은 닫혀도 결과가 이 화면으로 오지 않으므로 사람이 창에서 돌아오면 다시 읽는다.
// 설정은 이 화면 밖(`lophn settings set`, agent)에서도 바뀌므로 열려 있는 화면이 그것을 따라간다.
import { useEffect } from "react";

import { useSettingsChanged } from "../connection/events/hooks.tsx";
import type { SettingsSource } from "./source.ts";

export function useReload(
  source: Pick<SettingsSource, "watch">,
  load: () => void,
): void {
  useEffect(() => {
    let previous: string | null = null;
    const stop = source.watch((state) => {
      if (state.state === "ready" && previous !== "ready") load();
      previous = state.state;
    });
    if (previous === null) load();
    const focus = () => load();
    globalThis.addEventListener?.("focus", focus);
    return () => {
      stop();
      globalThis.removeEventListener?.("focus", focus);
    };
  }, [source, load]);
  useSettingsChanged(load);
}
