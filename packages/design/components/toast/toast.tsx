import type { FocusEvent, ReactNode } from "react";
import { CircleX, X } from "lucide-react";
import { t } from "@lophn/wording";
import { tokens } from "../../tokens.ts";
import { Button } from "../button/button.tsx";
import { IconButton } from "../icon-button/icon-button.tsx";
import { Icon } from "../icon.tsx";
import {
  type Clock,
  cx,
  iconPixels,
  milliseconds,
  systemClock,
  systemTimer,
  type Timer,
} from "../shared.ts";
import { useCountdown } from "./countdown.ts";
import styles from "./toast.module.css";

export type ToastTone = "neutral" | "error";
export type ToastDuration = "default" | "brief";

export interface ToastAction {
  id: string;
  label: string;
  // 마지막 단추를 주된 행동으로 보일 때.
  variant?: "primary";
}

export interface ToastProps {
  title: string;
  body?: string;
  tone?: ToastTone;
  // 제목 앞의 작은 그림(VendorIcon 같은).
  lead?: ReactNode;
  // 기본은 error면 alert, 아니면 status다.
  role?: "status" | "alert";
  // 행동은 최대 3개다.
  actions?:
    | readonly []
    | readonly [ToastAction]
    | readonly [ToastAction, ToastAction]
    | readonly [ToastAction, ToastAction, ToastAction];
  // 짧은 조작 확인은 brief(2초), 나머지는 default(5초). error는 시간으로 닫지 않는다.
  duration?: ToastDuration;
  onAction?: (id: string) => void;
  onClose: () => void;
  timer?: Timer;
  clock?: Clock;
}

// Radix Toast의 내부 timer 대신 주입한 timer·clock으로 남은 시간을 잰다. hover와 focus는 각각 멈춘다.
export function Toast(
  {
    title,
    body,
    lead,
    tone = "neutral",
    role = tone === "error" ? "alert" : "status",
    actions = [],
    duration = "default",
    onAction,
    onClose,
    timer = systemTimer,
    clock = systemClock,
  }: ToastProps,
) {
  const countdown = useCountdown({
    total: tone === "error"
      ? undefined
      : milliseconds(tokens.toast.duration[duration]),
    timer,
    clock,
    onDone: onClose,
  });
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    countdown.focus(false);
  };
  return (
    <div
      className={cx(styles.toast, styles[tone])}
      role={role}
      data-tone={tone}
      onPointerEnter={() => countdown.hover(true)}
      onPointerLeave={() => countdown.hover(false)}
      onFocus={() => countdown.focus(true)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      {tone === "error" && (
        <span className={styles.mark}>
          <Icon icon={CircleX} pixels={iconPixels("base")} />
        </span>
      )}
      <div className={styles.text}>
        <p className={styles.title}>
          {lead}
          <span>{title}</span>
        </p>
        {body !== undefined && <p className={styles.body}>{body}</p>}
        {actions.length > 0 && (
          <div className={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.variant}
                onClick={() => onAction?.(action.id)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <IconButton
        icon={X}
        label={t("common.button.close")}
        size="sm"
        onClick={onClose}
      />
    </div>
  );
}

// toast를 오른쪽 아래 toast 층에 쌓는다.
export function ToastStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
