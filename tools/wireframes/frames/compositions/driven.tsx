// 마운트된 뒤 steps를 눌러 하위 상태를 고정하는 wrapper. agent-setup 화면이 쓴다.
import { type ReactNode, useRef } from "react";

import { type Step, useDrive } from "./agent-setup/drive.ts";

/** 마운트된 뒤 steps를 눌러 하위 상태를 고정한다. global이면 portal로 열린 Dialog 안도 찾는다. */
export function Driven(
  { steps, global = false, children }: {
    steps: readonly Step[];
    global?: boolean;
    children: ReactNode;
  },
) {
  const div = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );
  useDrive(global ? body : div, steps);
  return global ? <>{children}</> : <div ref={div}>{children}</div>;
}
