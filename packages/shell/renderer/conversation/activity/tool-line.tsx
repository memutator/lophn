import { type ReactElement, useState } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import { lophnSpaceIcons } from "../../icons/mod.ts";

import type { ToolLineDetail, ToolLineView } from "./model.ts";
import styles from "./activity.module.css";

export interface ToolLineProps {
  tool: ToolLineView;
  detail: ToolLineDetail;
}

// 한 줄로 접힌 tool 호출("Read 3 documents ›"). collapsed는 접혀 있고 눌러 펼치며(aria-expanded),
// expanded는 펼쳐 보이고, hidden은 아무것도 그리지 않는다.
export function ToolLine({ tool, detail }: ToolLineProps): ReactElement | null {
  // 눌러 둔 값은 hidden이나 expanded를 지나 collapsed로 돌아와도 남는다.
  const [pressed, setPressed] = useState(false);
  if (detail === "hidden") return null;
  const open = detail === "expanded" || pressed;
  return (
    <div className={styles.tool} data-tool-line={tool.id}>
      <button
        type="button"
        className={styles.toolHead}
        aria-expanded={open}
        onClick={() => setPressed(!open)}
      >
        <span>{tool.label}</span>
        <Icon
          icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
          pixels={iconPixels("small")}
        />
      </button>
      {open
        ? (
          <ul className={styles.toolSub}>
            {tool.lines.map((line, index) => (
              <li key={index} data-tool-sub="">{line}</li>
            ))}
          </ul>
        )
        : null}
    </div>
  );
}
