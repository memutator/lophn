// 탭 위쪽에 뜨는 알림. 화면 안에 띠나 상자로 두지 않고 toast로 띄운다(window의 overlay로 얹는다).
import { useState } from "react";
import { Toast } from "@lophn/design/components";

import styles from "./workspace.module.css";

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

export function TopToast(
  { title, body, action }: {
    readonly title: string;
    readonly body: string;
    /** 고르러 가는 길의 단추 이름. */
    readonly action: string;
  },
) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className={styles.topToast}>
      <Toast
        title={title}
        body={body}
        actions={[{ id: "go", label: action }]}
        onAction={() => setOpen(false)}
        onClose={() => setOpen(false)}
        timer={NO_TIMER}
      />
    </div>
  );
}
