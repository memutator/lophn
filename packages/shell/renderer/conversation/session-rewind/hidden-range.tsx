// rewind가 숨긴 구간. 메시지는 지워지지 않고 thread에서 한 줄로 접힌다. 그 줄이 숨긴 수와 실제 복원·건너뜀
// 결과를 말하고, 펼치면 숨긴 줄을 읽기만 한다. 되돌린 것을 다시 하는 Redo는 없다.
import { type ReactElement, type ReactNode, useId, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";

import type { ThreadHidden } from "../agent-tab-source.ts";
import { itemLabel, reasonText } from "./text.ts";
import styles from "./hidden-range.module.css";

interface HiddenRangeProps
  extends Pick<ThreadHidden, "choice" | "count" | "restored" | "left"> {
  /** 숨긴 줄. 펼쳤을 때만 그린다. */
  children: ReactNode;
}

export function HiddenRange(props: HiddenRangeProps): ReactElement {
  const [open, setOpen] = useState(false);
  const entries = useId();
  const result = props.choice !== "restore_all"
    ? null
    : props.left.length > 0
    ? t("conversation.rewind.result-left", {
      restored: props.restored,
      left: props.left.length,
    })
    : props.restored > 0
    ? t("conversation.rewind.result-restored", { count: props.restored })
    : null;
  return (
    <div className={styles.range} data-hidden-range="">
      <div className={styles.head}>
        <span className={styles.label} data-hidden-label="">
          {t("conversation.label.rewind-hidden", { count: props.count })}
        </span>
        <span className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={entries}
            onClick={() => setOpen(!open)}
          >
            {t(
              open
                ? "conversation.button.hidden-hide"
                : "conversation.button.hidden-show",
            )}
          </Button>
        </span>
      </div>
      {result === null
        ? null
        : <p className={styles.result} data-hidden-result="">{result}</p>}
      {props.left.length === 0
        ? null
        : (
          <ul className={styles.left} data-hidden-left="">
            {props.left.map((item) => {
              const reason = reasonText(item.reason);
              return (
                <li key={`${item.kind}:${item.target}:${item.result}`}>
                  <span
                    className={item.kind === "file" ? styles.mono : undefined}
                  >
                    {itemLabel(item)}
                  </span>
                  {reason === null ? null : <>{" "}{reason}</>}
                </li>
              );
            })}
          </ul>
        )}
      {open
        ? (
          <div className={styles.entries} id={entries} data-hidden-entries="">
            {props.children}
          </div>
        )
        : null}
    </div>
  );
}
