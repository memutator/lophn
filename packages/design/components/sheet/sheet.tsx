import * as Radix from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import type { DialogWidth } from "../dialog/dialog.tsx";
import { useReturnFocus } from "../return-focus.ts";
import { cx } from "../shared.ts";
import parts from "../dialog/dialog.module.css";
import styles from "./sheet.module.css";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  // 폭은 dialog 폭 token 두 개를 그대로 쓴다.
  width?: DialogWidth;
  container?: HTMLElement | null;
  // 닫힐 때 연 자리로 focus를 돌린다. 연 자리가 다른 renderer에 있으면 끈다.
  returnFocus?: boolean;
}

// backdrop 없는 non-modal Dialog: Escape·바깥 click·바깥 focus 이동에 닫는다.
export function Sheet(
  {
    open,
    onOpenChange,
    title,
    children,
    actions,
    width = "default",
    container,
    returnFocus = true,
  }: SheetProps,
) {
  const focus = useReturnFocus(returnFocus);
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Radix.Portal container={container}>
        <Radix.Content
          className={cx(styles.sheet, parts[width])}
          data-width={width}
          aria-describedby={undefined}
          {...focus}
        >
          <Radix.Title className={parts.title}>{title}</Radix.Title>
          {children !== undefined && (
            <div className={parts.body}>{children}</div>
          )}
          {actions !== undefined && (
            <div className={parts.actions}>{actions}</div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
