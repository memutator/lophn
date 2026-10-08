import { type ReactNode, useState } from "react";
import { Icon, iconPixels, lophnSpaceIcons } from "@lophn/design/components";

import styles from "../roles.module.css";

export interface DiscloseProps {
  /** 닫혀 있을 때도 보이는 머리 글. */
  label: string;
  /** 구별용 이름(테스트·접근성). */
  name: string;
  /** 처음부터 펼쳐 둔다. */
  initiallyOpen?: boolean;
  /** 접힌 머리 옆에 남는 요약. 접어도 실패는 보인다. */
  summary?: ReactNode;
  children: ReactNode;
}

// 접고 펴는 자리. 펼치기 전에는 안쪽을 만들지 않아 본문 읽기 같은 일을 미룬다.
export function Disclose(
  { label, name, initiallyOpen = false, summary, children }: DiscloseProps,
) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className={styles.disclose} data-disclose={name}>
      <button
        type="button"
        className={styles.discloseHead}
        aria-expanded={open}
        data-disclose-toggle={name}
        onClick={() => setOpen(!open)}
      >
        <Icon
          icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
          pixels={iconPixels("base")}
        />
        <span>{label}</span>
      </button>
      {summary === undefined
        ? null
        : <div className={styles.discloseSummary}>{summary}</div>}
      {open ? <div className={styles.discloseBody}>{children}</div> : null}
    </section>
  );
}
