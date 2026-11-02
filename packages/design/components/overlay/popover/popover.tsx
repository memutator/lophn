import * as Radix from "@radix-ui/react-popover";
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
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
  // trigger에 pointer를 올리면 열고, trigger와 면 밖으로 나가면 닫는다. 누르기는 trigger 자기 일이라 열지 않는다.
  hover?: boolean;
}

// 지나가는 pointer에 열리지 않고, trigger에서 면으로 건너가는 동안 닫히지 않는 틈.
const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 200;

// modal이 아니라서 바깥 click·focus 이동·Escape에 닫히고 trigger로 focus를 돌린다.
export function Popover({
  trigger,
  children,
  container,
  placement = "beside",
  returnFocus = true,
  onEscapeKeyDown,
  hover = false,
  ...state
}: PopoverProps) {
  if (hover) {
    return (
      <HoverPopover
        trigger={trigger}
        container={container}
        placement={placement}
      >
        {children}
      </HoverPopover>
    );
  }
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

function HoverPopover({
  trigger,
  children,
  container,
  placement,
}: Pick<PopoverProps, "trigger" | "children" | "container"> & {
  placement: Placement;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const later = (next: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setOpen(next),
      next ? HOVER_OPEN_MS : HOVER_CLOSE_MS,
    );
  };
  const now = (next: boolean) => {
    clearTimeout(timer.current);
    setOpen(next);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Radix.Root open={open} onOpenChange={now}>
      {/* Trigger가 아니라 Anchor라서 누르기가 면을 토글하지 않는다. 누르면 trigger의 일을 하고 닫는다. */}
      <Radix.Anchor
        asChild
        onPointerEnter={() => later(true)}
        onPointerLeave={() => later(false)}
        onClick={() => now(false)}
      >
        {trigger}
      </Radix.Anchor>
      <Radix.Portal container={container}>
        <Radix.Content
          className={styles.popover}
          side="bottom"
          {...placementProps(placement)}
          // pointer로 연 면이 trigger의 focus를 빼앗지 않는다.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={keepFocus}
          onPointerEnter={() => later(true)}
          onPointerLeave={() => later(false)}
          onClick={() => now(false)}
          {...componentMark("Popover")}
        >
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
