// 8 MiB를 넘어 편집기로 열지 못하는 글. 읽기만 한다.
import styles from "./read-only-text.module.css";

export function ReadOnlyText({ text, label }: { text: string; label: string }) {
  return (
    <pre className={styles.text} aria-label={label} tabIndex={0}>
      {text}
    </pre>
  );
}
