import * as Radix from "@radix-ui/react-dropdown-menu";
import type { ReactElement, ReactNode } from "react";
import { keepFocus } from "../return-focus.ts";
import { Icon, type IconProps } from "../icon.tsx";
import { iconPixels, type Placement, placementProps } from "../shared.ts";
import styles from "./menu.module.css";

export interface MenuItem {
  id: string;
  // 글 하나, 또는 호출자가 data 표식을 단 요소. 요소로 주면 textValue를 함께 준다.
  label: ReactNode;
  // 앞에 놓는 작은 그림(avatar 등). 장식이라 이름은 label이 맡는다.
  leading?: ReactNode;
  // 줄에 다는 `data-*` 표식. 호출자 화면이 줄을 찾는 자리다.
  data?: Readonly<Record<`data-${string}`, string>>;
  // 키보드 typeahead가 쓰는 글. label이 글이면 생략한다.
  textValue?: string;
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

// 항목 앞(leading)에 놓는 아이콘 칸. icon을 주면 design 아이콘을, 아니면 children(FileIcon 같은 요소)을 칸에 맞춰 감싼다.
export function MenuIcon(
  { icon, children }: { icon?: IconProps["icon"]; children?: ReactNode },
) {
  return (
    <span className={styles.icon}>
      {icon === undefined
        ? children
        : <Icon icon={icon} pixels={iconPixels("base")} />}
    </span>
  );
}

// 키보드 이동·Escape·focus 복귀는 Radix DropdownMenu가 맡는다. dialog 안에서도 popover 층에 뜬다.
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
              textValue={item.textValue}
              onSelect={() => onSelect(item.id)}
              {...item.data}
            >
              {item.leading}
              {item.label}
            </Radix.Item>
          ))}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
