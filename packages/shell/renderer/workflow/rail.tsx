// workflow의 단계를 위에서 아래로 잇는 세로 줄. 왼쪽 칸에 표시(번호나 상태 아이콘)와 다음 단계로 내려가는 선이 있고 오른쪽이 그 단계의 본문이다.
// 새 run 칸과 run 화면이 같이 쓴다. 선언의 순서일 뿐이고 graph가 아니다.
import type { ReactNode } from "react";

import styles from "./rail.module.css";

export type RailTone =
  | "idle"
  | "start"
  | "good"
  | "warning"
  | "serious"
  | "done"
  | "skipped";

export function Rail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <ol className={styles.rail} aria-label={label}>
      {children}
    </ol>
  );
}

export function RailStage({
  marker,
  tone = "idle",
  bare = false,
  children,
  ...rest
}: {
  marker: ReactNode;
  tone?: RailTone;
  /** 표시가 스스로 둥근 아이콘이라 테두리를 두르지 않는다. */
  bare?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <li
      className={styles.stage}
      data-tone={tone}
      data-bare={bare ? "" : undefined}
      {...rest}
    >
      <span className={styles.gutter} aria-hidden="true">
        <span className={styles.marker}>{marker}</span>
        <span className={styles.line} />
      </span>
      <div className={styles.body}>{children}</div>
    </li>
  );
}
