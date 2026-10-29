// Recent에서 지운 줄을 project마다 기억한다. transcript는 건드리지 않고 목록에서만 뺀다.
// 새 움직임(at)이 지운 때보다 뒤면 다시 보인다.
import { useCallback, useEffect, useState } from "react";

const PREFIX = "lophn.recent.hidden.";

function load(project: string): Map<string, number> {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage?.getItem(PREFIX + project) ?? "{}",
    );
    if (typeof parsed !== "object" || parsed === null) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

export function useHiddenRecent(project: string | null): {
  readonly hidden: ReadonlyMap<string, number>;
  hide(key: string, at: number): void;
} {
  const id = project ?? "";
  const [hidden, setHidden] = useState(() => load(id));
  useEffect(() => {
    setHidden(load(id));
  }, [id]);
  const hide = useCallback(
    (key: string, at: number) => {
      setHidden((prev) => {
        const next = new Map(prev);
        next.set(key, at);
        try {
          globalThis.localStorage?.setItem(
            PREFIX + id,
            JSON.stringify(Object.fromEntries(next)),
          );
        } catch {
          // 저장을 못 해도 이 창에서는 지운다.
        }
        return next;
      });
    },
    [id],
  );
  return { hidden, hide };
}
