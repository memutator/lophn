import * as Radix from "@radix-ui/react-tooltip";
import {
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { tokens } from "../../tokens.ts";
import {
  componentMark,
  milliseconds,
  type Placement,
  placementProps,
  systemTimer,
  type Timer,
} from "../shared.ts";
import styles from "./tooltip.module.css";

export interface TooltipProps {
  content: ReactNode;
  // hover·focus를 받는 trigger 하나.
  children: ReactElement;
  // 지연을 이미 다른 곳에서 마친 표시(overlay view)는 open을 준다.
  open?: boolean;
  placement?: Placement;
  container?: HTMLElement | null;
  timer?: Timer;
}

const DELAY = milliseconds(tokens.tooltip.delay);

// Radix Trigger는 pointermove마다 자기 기본 지연 timer를 건다. 지연은 주입한 timer 하나로만 잰다.
function skipRadixDelay(event: PointerEvent<HTMLElement>) {
  event.preventDefault();
}

// 400ms 지연은 주입한 timer로 잰다. Radix의 열기 요청은 무시하고 닫기 요청만 받는다.
export function Tooltip(
  {
    content,
    children,
    open,
    placement = "beside",
    container,
    timer = systemTimer,
  }: TooltipProps,
) {
  const [shown, setShown] = useState(false);
  // 기다리는 표시 하나. 만든 timer로만 지우고, 지운 뒤의 늦은 callback은 무시한다.
  const pending = useRef<{ timer: Timer; handle: unknown } | undefined>(
    undefined,
  );
  const cancel = () => {
    const waiting = pending.current;
    pending.current = undefined;
    if (waiting) waiting.timer.clear(waiting.handle);
  };
  const show = () => {
    if (open !== undefined || pending.current || shown) return;
    const waiting = { timer, handle: undefined as unknown };
    pending.current = waiting;
    waiting.handle = timer.set(() => {
      if (pending.current !== waiting) return;
      pending.current = undefined;
      setShown(true);
    }, DELAY);
  };
  const hide = () => {
    cancel();
    setShown(false);
  };
  useEffect(() => cancel, [timer]);
  return (
    <Radix.Provider skipDelayDuration={0}>
      <Radix.Root
        open={open ?? shown}
        onOpenChange={(next) => {
          if (!next) hide();
        }}
      >
        <Radix.Trigger
          asChild
          onPointerEnter={show}
          onPointerMove={skipRadixDelay}
          onPointerLeave={hide}
          onFocus={show}
          onBlur={hide}
        >
          {children}
        </Radix.Trigger>
        <Radix.Portal container={container}>
          <Radix.Content
            className={styles.tooltip}
            side="bottom"
            {...placementProps(placement)}
            {...componentMark("Tooltip")}
          >
            {content}
          </Radix.Content>
        </Radix.Portal>
      </Radix.Root>
    </Radix.Provider>
  );
}
