// agent command를 창의 focus 표에 건다. 여러 agent 화면이 mount되어도 command는 focus가 있는 화면의 동작을 부른다.
// 화면 안에 focus가 들어올 때 `claim`을 부르면 `routes`에 적힌 command가 이 화면의 것이 된다. 동작과 `when`은 매번
// `routes.current`의 최신 것을 본다(그릴 때마다 새로 적어도 된다).
import { useCallback, useEffect, useRef } from "react";

import { useWindowCommands } from "../commands/react.tsx";
import type { Disposable } from "../commands/registry.ts";

export interface FocusRoute {
  readonly run: () => void;
  readonly when: () => boolean;
}

export type FocusRoutes = Readonly<Record<string, FocusRoute>>;

export function useFocusRoutes(routes: {
  readonly current: FocusRoutes;
}): () => void {
  const commands = useWindowCommands();
  const held = useRef<Disposable[]>([]);
  const claim = useCallback(() => {
    if (commands === null) return;
    for (const one of held.current) one.dispose();
    held.current = Object.keys(routes.current).map((id) =>
      commands.focus.set(
        id,
        () => routes.current[id]?.run(),
        () => routes.current[id]?.when() ?? false,
      ),
    );
  }, [commands, routes]);
  useEffect(
    () => () => {
      for (const one of held.current) one.dispose();
      held.current = [];
    },
    [],
  );
  return claim;
}
