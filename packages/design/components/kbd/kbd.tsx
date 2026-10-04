import styles from "./kbd.module.css";

export interface KbdProps {
  // 함께 누르는 키 이름. 호출자가 플랫폼에 맞게 준다.
  keys: readonly string[];
}

export function Kbd({ keys }: KbdProps) {
  return (
    <kbd className={styles.combo}>
      {keys.map((key) => <kbd key={key} className={styles.key}>{key}</kbd>)}
    </kbd>
  );
}
