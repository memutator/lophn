import { useState } from "react";
import { t } from "@lophn/i18n";
import { Button } from "../../primitives/button/button.tsx";
import { componentMark } from "../../_shared/shared.ts";
import styles from "../reading.module.css";
import { DiffMark } from "./diff-mark.tsx";

interface DiffSpan {
  text: string;
  // 바뀐 단어는 진한 단어 배경을 쓴다.
  changed?: boolean;
}

export interface DiffLine {
  kind: "same" | "add" | "delete";
  oldNumber?: number;
  newNumber?: number;
  text: string;
  // 이어 붙이면 text가 되는 조각. 없으면 줄 전체가 한 조각이다.
  spans?: readonly DiffSpan[];
}

export interface DiffViewProps {
  lines: readonly DiffLine[];
  /** 접어서 보이는 줄 수. 넘으면 [Show all]이 붙는다. 0이면 접지 않는다. */
  maxLines?: number;
}

// 추가·삭제 줄은 정한 diff 배경과 +/− 기호를 함께 쓰고 글자는 primary다. 줄 번호를 모르면 번호 칸을 그리지 않는다.
export function DiffView({ lines, maxLines = 12 }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const folded = maxLines > 0 && lines.length > maxLines && !expanded;
  const shown = folded ? lines.slice(0, maxLines) : lines;
  const numbered = lines.some(
    (line) => line.oldNumber !== undefined || line.newNumber !== undefined,
  );
  return (
    <div className={styles.diffView} {...componentMark("DiffView")}>
      <table className={styles.diff}>
        <tbody>
          {shown.map((line, index) => (
            <tr
              key={index}
              className={styles.diffRow}
              data-diff={line.kind === "same" ? undefined : line.kind}
            >
              {numbered ? (
                <>
                  <td className={styles.lineNumber}>{line.oldNumber ?? ""}</td>
                  <td className={styles.lineNumber}>{line.newNumber ?? ""}</td>
                </>
              ) : null}
              <td className={styles.sign}>
                {line.kind === "same" ? null : <DiffMark kind={line.kind} />}
              </td>
              <td className={styles.diffText}>
                {line.text === "" ? " " : line.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {folded ? (
        <Button size="sm" variant="secondary" onClick={() => setExpanded(true)}>
          {t("common.button.show-all")}
        </Button>
      ) : null}
    </div>
  );
}
