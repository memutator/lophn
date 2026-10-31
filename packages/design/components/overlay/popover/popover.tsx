import * as Radix from "@radix-ui/react-popover";
import type { ReactElement, ReactNode } from "react";
import { keepFocus } from "../return-focus.ts";
import {
  componentMark,
  type Placement,
  placementProps,
} from "../../_shared/shared.ts";
import styles from "./popover.module.css";

export interface PopoverProps {
  // 여는 요소 하나. overlay view에서는 위치를 잡는 빈 anchor다.
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  container?: HTMLElement | null;
  placement?: Placement;
  // Escape를 눌렀을 때. preventDefault하면 닫히지 않는다(안의 입력이 Escape를 먼저 쓸 때).
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  // 닫힐 때 trigger로 focus를 돌린다. 연 자리가 다른 renderer에 있으면 끈다.
  returnFocus?: boolean;
}

// modal이 아니라서 바깥 click·focus 이동·Escape에 닫히고 trigger로 focus를 돌린다.
export function Popover({
  trigger,
  children,
  container,
  placement = "beside",
  returnFocus = true,
  onEscapeKeyDown,
  ...state
}: PopoverProps) {
  return (
    <Radix.Root {...state}>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal container={container}>
        <Radix.Content
          className={styles.popover}
          side="bottom"
          {...placementProps(placement)}
          onCloseAutoFocus={returnFocus ? undefined : keepFocus}
          onEscapeKeyDown={onEscapeKeyDown}
          {...componentMark("Popover")}
        >
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export interface PopoverRowProps {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

// popover 안의 고를 수 있는 한 줄. 높이는 menu 행과 같은 32px이다.
export function PopoverRow({ children, onSelect, disabled }: PopoverRowProps) {
  return (
    <button
      type="button"
      className={styles.row}
      disabled={disabled}
      onClick={onSelect}
      {...componentMark("PopoverRow")}
    >
      {children}
    </button>
  );
}
