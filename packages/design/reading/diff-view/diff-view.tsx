import { t } from "@lophn/wording";
import { DiffMark } from "../../components/mod.ts";
import styles from "../reading.module.css";

export interface DiffSpan {
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
  // 비교는 호출자가 계산한다. 여기서는 그리기만 한다.
  lines: readonly DiffLine[];
}

function same(lines: readonly DiffLine[]): boolean {
  return lines.every((line) => line.kind === "same");
}

// 추가·삭제 줄은 정한 diff 배경과 +/− 기호를 함께 쓰고 글자는 primary다(R14).
export function DiffView({ lines }: DiffViewProps) {
  if (same(lines)) {
    return <p className={styles.identical}>{t("document.diff.identical")}</p>;
  }
  return (
    <table className={styles.diff}>
      <tbody>
        {lines.map((line, index) => (
          <tr key={index} className={styles.diffRow} data-diff={line.kind}>
            <td className={styles.lineNumber}>{line.oldNumber}</td>
            <td className={styles.lineNumber}>{line.newNumber}</td>
            <td className={styles.sign}>
              {line.kind !== "same" && <DiffMark kind={line.kind} />}
            </td>
            <td className={styles.diffText}>
              {(line.spans ?? [{ text: line.text }]).map((span, part) =>
                span.changed && line.kind !== "same"
                  ? <mark key={part} className={styles.word}>{span.text}</mark>
                  : <span key={part}>{span.text}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
