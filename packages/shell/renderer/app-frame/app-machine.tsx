// 앱 화면 탭·앱 panel 탭이 어느 기계의 앱을 여는가. 같은 앱 id는 기계를 건너 한 앱이라(같은 앱은 한 줄) 이 컴퓨터에 그 앱이
// 있으면 탭의 기계가 다른 기계여도 이 컴퓨터의 것을 연다. 없으면 탭의 기계의 것이다.
import { type ReactNode, useEffect, useState } from "react";

import type { AppsSource } from "../apps/source.ts";
import { type MachineRef, MachineScope } from "../desktop/machines/scope.tsx";

export function AppOnMachine({
  app,
  machine,
  here,
  children,
}: {
  app: string;
  /** 탭의 기계. */
  machine: MachineRef;
  /** 이 컴퓨터의 앱 목록. */
  here: AppsSource;
  /** 고른 기계의 화면. 이 컴퓨터로 고르면 이 컴퓨터의 범위 안에서 그린다. */
  children: (machine: MachineRef) => ReactNode;
}) {
  // undefined는 이 컴퓨터를 읽는 중이다.
  const [hasHere, setHasHere] = useState<boolean | undefined>(
    machine === null ? true : undefined,
  );
  useEffect(() => {
    if (machine === null) return;
    let live = true;
    setHasHere(undefined);
    void here.get(app).then((result) => {
      if (live) {
        setHasHere(
          result.ok && result.value !== null && !result.value.archived,
        );
      }
    });
    return () => {
      live = false;
    };
  }, [app, machine, here]);
  if (machine === null) return children(null);
  if (hasHere === undefined) return null;
  return hasHere ? (
    <MachineScope machine={null}>{children(null)}</MachineScope>
  ) : (
    children(machine)
  );
}
