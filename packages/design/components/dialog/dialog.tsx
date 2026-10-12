import * as Radix from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useReturnFocus } from "../return-focus.ts";
import { cx } from "../shared.ts";
import styles from "./dialog.module.css";

export type DialogWidth = "default" | "wide";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 사람이 읽는 제목. 호출자가 wording key나 owner 문구로 준다.
  title: string;
  children?: ReactNode;
  // 오른쪽 끝에 주 행동을 둔 버튼 줄.
  actions?: ReactNode;
  width?: DialogWidth;
  container?: HTMLElement | null;
  // 닫힐 때 연 자리로 focus를 돌린다. 연 자리가 다른 renderer에 있으면 끈다.
  returnFocus?: boolean;
}

// modal: backdrop 위 dialog 층에 두고 focus를 가둔 뒤 닫히면 연 자리로 돌려준다.
export function Dialog(
  {
    open,
    onOpenChange,
    title,
    children,
    actions,
    width = "default",
    container,
    returnFocus = true,
  }: DialogProps,
) {
  const focus = useReturnFocus(returnFocus);
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal container={container}>
        <Radix.Overlay className={styles.backdrop} />
        <Radix.Content
          className={cx(styles.dialog, styles[width])}
          data-width={width}
          aria-describedby={undefined}
          {...focus}
        >
          <Radix.Title className={styles.title}>{title}</Radix.Title>
          {children !== undefined && (
            <div className={styles.body}>{children}</div>
          )}
          {actions !== undefined && (
            <div className={styles.actions}>{actions}</div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
