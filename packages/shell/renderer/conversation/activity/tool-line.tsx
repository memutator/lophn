import { type ReactElement, type ReactNode, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { commonIcons } from "../../icons/mod.ts";

import type { ToolLineDetail, ToolLineView } from "./model.ts";
import styles from "./activity.module.css";

interface ToolLineProps {
  tool: ToolLineView;
  detail: ToolLineDetail;
}

/** 접히는 줄 하나. 펼치고 접는 상태는 부르는 쪽이 쥔다. 펼치면 children(하위 줄)이 보인다. */
export function ToolRow(
  { id, label, open, onToggle, children }: {
    id?: string;
    label: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
  },
): ReactElement {
  return (
    <div className={styles.tool} data-tool-line={id}>
      <button
        type="button"
        className={styles.toolHead}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <Icon
          icon={open ? commonIcons.collapse : commonIcons.expand}
          pixels={iconPixels("small")}
        />
      </button>
      {open ? <ul className={styles.toolSub}>{children}</ul> : null}
    </div>
  );
}

// 한 줄로 접힌 tool 호출("Read 3 documents ›"). collapsed는 접혀 있고 눌러 펼치며(aria-expanded),
// expanded는 펼쳐 보이고, hidden은 아무것도 그리지 않는다.
export function ToolLine({ tool, detail }: ToolLineProps): ReactElement | null {
  // 눌러 둔 값은 hidden이나 expanded를 지나 collapsed로 돌아와도 남는다.
  const [pressed, setPressed] = useState(false);
  if (detail === "hidden") return null;
  const open = detail === "expanded" || pressed;
  return (
    <ToolRow
      id={tool.id}
      label={tool.label}
      open={open}
      onToggle={() => setPressed(!open)}
    >
      {tool.lines.map((line, index) => (
        <li key={index} data-tool-sub="">{line}</li>
      ))}
    </ToolRow>
  );
}
