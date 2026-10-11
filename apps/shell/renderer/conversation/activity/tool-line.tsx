import type { ReactElement } from "react";

import type { ToolLineDetail, ToolLineView } from "./model.ts";

export interface ToolLineProps {
  tool: ToolLineView;
  detail: ToolLineDetail;
}

// 한 줄로 접힌 tool 호출("Read 3 documents ›"). collapsed는 접혀 있고 눌러 펼치며(aria-expanded),
// expanded는 펼쳐 보이고, hidden은 아무것도 그리지 않는다(shell/desktop#R41, R42).
export function ToolLine(_props: ToolLineProps): ReactElement | null {
  throw new Error("not implemented: agent-I27");
}
