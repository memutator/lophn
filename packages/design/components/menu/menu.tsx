import * as Radix from "@radix-ui/react-dropdown-menu";
import type { ReactElement } from "react";
import { keepFocus } from "../return-focus.ts";
import { type Placement, placementProps } from "../shared.ts";
import styles from "./menu.module.css";

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface MenuProps {
  // 여는 요소 하나. overlay view에서는 위치를 잡는 빈 anchor다.
  trigger: ReactElement;
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  container?: HTMLElement | null;
  placement?: Placement;
  // 닫힐 때 trigger로 focus를 돌린다. 연 자리가 다른 renderer에 있으면 끈다.
  returnFocus?: boolean;
}

// 키보드 이동·Escape·focus 복귀는 Radix DropdownMenu가 맡는다. dialog 안에서도 popover 층에 뜬다(R20).
export function Menu(
  {
    trigger,
    items,
    onSelect,
    container,
    placement = "beside",
    returnFocus = true,
    ...state
  }: MenuProps,
) {
  return (
    <Radix.Root {...state}>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal container={container}>
        <Radix.Content
          className={styles.menu}
          side="bottom"
          {...placementProps(placement)}
          onCloseAutoFocus={returnFocus ? undefined : keepFocus}
        >
          {items.map((item) => (
            <Radix.Item
              key={item.id}
              className={styles.item}
              disabled={item.disabled}
              onSelect={() => onSelect(item.id)}
            >
              {item.label}
            </Radix.Item>
          ))}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
