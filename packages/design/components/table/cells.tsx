import {
  formatDate,
  formatNumber,
  formatRelativeTime,
  t,
} from "@lophn/wording";
import { CopyButton } from "../copy-button/copy-button.tsx";
import type { Clipboard } from "../shared.ts";
import { shortId } from "./model.ts";
import styles from "./table.module.css";

export interface CellFormat {
  locale: string;
  now: Date;
  // 절대 시각 tooltip의 시간대. 없으면 실행 환경의 시간대다.
  timeZone?: string;
  clipboard: Clipboard;
}

export function TextCell({ value }: { value: string | undefined }) {
  // 말줄임된 글의 전체는 tooltip으로 읽는다.
  return <td className={styles.text} data-kind="text" title={value}>{value}
  </td>;
}

export function NumberCell(
  { value, format }: { value: number | undefined; format: CellFormat },
) {
  return (
    <td className={styles.number} data-kind="number">
      {value === undefined
        ? undefined
        : formatNumber(value, format.locale, { notation: "standard" })}
    </td>
  );
}

export function TimeCell(
  { value, format }: { value: Date | undefined; format: CellFormat },
) {
  if (value === undefined) {
    return <td className={styles.text} data-kind="time" />;
  }
  const absolute = formatDate(value, format.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: format.timeZone,
  });
  return (
    <td className={styles.text} data-kind="time">
      <time dateTime={value.toISOString()} title={absolute}>
        {formatRelativeTime(value, format.now, format.locale)}
      </time>
    </td>
  );
}

// 개발자 diagnostics에서만 그린다. 앞 8자와 전체 값 복사.
export function IdCell(
  { value, format }: { value: string; format: CellFormat },
) {
  return (
    <td className={styles.id} data-kind="id">
      <span className={styles.idValue}>
        <code className={styles.code}>{shortId(value)}</code>
        <CopyButton
          text={value}
          label={t("common.button.copy-id")}
          clipboard={format.clipboard}
        />
      </span>
    </td>
  );
}
