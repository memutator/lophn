// 앱 화면 탭·앱 panel 탭이 어느 기계의 앱을 여는가. 같은 앱 id는 기계를 건너 한 앱이라(같은 앱은 한 줄) 이 컴퓨터에 그 앱이
// 있으면 탭의 기계가 다른 기계여도(꺼져 있어도) 이 컴퓨터의 것을 연다. 없으면 탭의 기계의 것이다.
import { type ReactNode, useEffect, useState } from "react";

import {
  type MachineRef,
  MachineScope,
  useMachineHub,
} from "../desktop/machines/scope.tsx";

/**
 * 탭의 기계가 다른 기계일 때 이 컴퓨터에 그 앱이 있는가(있고 보관하지 않았다). 탭의 기계가 이 컴퓨터이거나 앱이 없는 탭이면
 * false다. undefined는 읽는 중이다. 탭 범위(TabScope)가 그 기계의 꺼짐 안내보다 먼저 묻는다.
 */
export function useAppHere(
  app: string | undefined,
  machine: MachineRef,
): boolean | undefined {
  // hub가 없는 화면(기계가 이 컴퓨터뿐)은 묻지 않는다.
  const here = useMachineHub()?.get(null).apps;
  const asks = app !== undefined && machine !== null && here !== undefined;
  const [has, setHas] = useState<boolean | undefined>(asks ? undefined : false);
  useEffect(() => {
    if (!asks) {
      setHas(false);
      return;
    }
    let live = true;
    setHas(undefined);
    void here!.get(app!).then((result) => {
      if (live) {
        setHas(result.ok && result.value !== null && !result.value.archived);
      }
    });
    return () => {
      live = false;
    };
  }, [app, asks, here]);
  return asks ? has : false;
}

export function AppOnMachine({
  app,
  machine,
  children,
}: {
  app: string;
  /** 탭의 기계. */
  machine: MachineRef;
  /** 고른 기계의 화면. 이 컴퓨터로 고르면 이 컴퓨터의 범위 안에서 그린다. */
  children: (machine: MachineRef) => ReactNode;
}) {
  const here = useAppHere(app, machine);
  if (machine === null) return children(null);
  if (here === undefined) return null;
  return here ? (
    <MachineScope machine={null}>{children(null)}</MachineScope>
  ) : (
    children(machine)
  );
}
