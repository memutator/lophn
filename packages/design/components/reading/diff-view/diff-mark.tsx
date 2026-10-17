import { componentMark } from "../../_shared/shared.ts";
import styles from "./diff-mark.module.css";

export type DiffKind = "add" | "delete";

const DIFF_SIGNS: Record<DiffKind, string> = { add: "+", delete: "−" };

// diff 줄의 +/− 기호. 줄 배경색과 함께 쓰며 색 없이도 추가·삭제를 읽는다.
export function DiffMark({ kind }: { kind: DiffKind }) {
  return (
    <span
      className={styles.sign}
      data-diff={kind}
      {...componentMark("DiffMark")}
    >
      {DIFF_SIGNS[kind]}
    </span>
  );
}
