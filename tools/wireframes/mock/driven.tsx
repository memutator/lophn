// 마운트된 뒤 steps를 눌러 하위 상태를 고정하는 wrapper. agent-setup 화면이 쓴다.
import type { ReactNode } from "react";

import { runSteps, type Step, useDrive } from "./drive.ts";

export function Driven(
  { steps, children }: { steps: readonly Step[]; children: ReactNode },
) {
  useDrive(() => runSteps(steps));
  return <>{children}</>;
}
