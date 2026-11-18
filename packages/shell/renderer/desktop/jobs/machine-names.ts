// event job이 다른 컴퓨터의 앱 event를 듣는다고 말할 때 그 컴퓨터를 이름으로 부르려고 명단의 이름을 찾는다. 명단에 없으면 null이다.
import { useCallback } from "react";

import { useMachinesView } from "../machines/context.tsx";
import type { MachineNameOf } from "./model.ts";

export function useMachineNameOf(): MachineNameOf {
  const view = useMachinesView();
  return useCallback(
    (id) =>
      view === null
        ? null
        : view.thisComputer?.id === id
          ? view.thisComputer.name
          : (view.machines.find((each) => each.id === id)?.name ?? null),
    [view],
  );
}
