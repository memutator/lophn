// git_diff 탭의 inline / side-by-side 선택은 설정 `shell.diff_view`(이 컴퓨터)에 둔다. localStorage를 따로 정본으로 두지 않는다.
import { useCallback, useEffect, useState } from "react";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { useStateChanged } from "../../desktop/connection/core-read.ts";
import { useMachineEventClient } from "../../desktop/machines/scope.tsx";

export type DiffLayout = "inline" | "side-by-side";

const KEY = "shell.diff_view";

interface SettingsList {
  settings: { key: string; default?: unknown; chosen?: unknown }[];
}

export function useDiffLayout(
  core: CoreSource | undefined,
): [DiffLayout, (next: DiffLayout) => void] {
  const [layout, setLayout] = useState<DiffLayout>("inline");
  const load = useCallback(() => {
    if (core === undefined) return;
    void core
      .call({
        kind: "memory",
        resource: "settings",
        method: "list",
        body: { keys: [KEY] },
      })
      .then((reply) => {
        if (!reply.ok) return;
        const found = (reply.value as SettingsList).settings.find(
          (one) => one.key === KEY,
        );
        const value = found?.chosen ?? found?.default;
        if (value === "inline" || value === "side-by-side") setLayout(value);
      });
  }, [core]);
  useEffect(load, [load]);
  // 이 컴퓨터의 설정이라 원격 workspace의 diff 탭도 이 컴퓨터의 settings 변경을 듣는다. 다른 탭의 토글과 `lophn settings set`을 따른다.
  useStateChanged(["settings"], load, useMachineEventClient(null));
  const set = (next: DiffLayout) => {
    setLayout(next);
    void core?.call({
      kind: "memory",
      resource: "settings",
      method: "update",
      body: { changes: [{ key: KEY, action: "set", value: next }] },
    });
  };
  return [layout, set];
}
