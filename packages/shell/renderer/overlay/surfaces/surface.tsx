import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
// lophn 화면이 공용 UI SDK의 첫 소비자다. 앱이 쓰는 것과 같은 overlay·조작을 그린다.
import {
  Button,
  type Clock,
  Dialog,
  type IconProps,
  Menu,
  Palette,
  Popover,
  PopoverRow,
  Sheet,
  systemClock,
  systemTimer,
  type Timer,
  Toast,
  type ToastAction,
  ToastStack,
  Tooltip,
} from "@lophn/design/components";
import { paletteIcons } from "../../icons/mod.ts";
import type { OverlaySurface, PaletteIcon } from "../../../ipc/overlay.ts";
import {
  FeedbackDialog,
  type FeedbackDialogApi,
} from "../feedback/feedback-dialog.tsx";
import type { SurfaceActions, SurfaceMount } from "../registry.ts";
import styles from "./surface.module.css";

interface SurfaceViewProps {
  surface: OverlaySurface;
  host: HTMLElement;
  actions: SurfaceActions;
  timer: Timer;
  clock: Clock;
}

// owner의 label·text·choice는 React text로만 그린다. 고르기는 api.result로만 돌아가고 command를 보내지 않는다.
function SurfaceView(
  { surface, host, actions, timer, clock }: SurfaceViewProps,
) {
  // Radix menu는 고른 뒤 같은 event 안에서 닫힘도 알린다. 고른 결과 하나만 보낸다.
  const picking = useRef(false);
  const select = (choiceId: string) => {
    picking.current = true;
    queueMicrotask(() => {
      picking.current = false;
    });
    actions.select(choiceId);
  };
  const onOpenChange = (open: boolean) => {
    if (!open && !picking.current) actions.close();
  };
  const { label, text, choices } = surface.model;
  const enabled = choices.filter((choice) => !choice.disabled);
  // 연 자리는 shell renderer에 있다. overlay 안 표면은 rect 왼쪽 위 크기 없는 anchor에서 그린다.
  const anchor = <span className={styles.anchor} />;
  const shared = { container: host, returnFocus: false } as const;
  const buttons = choices.map((choice, index) => (
    <Button
      key={choice.id}
      variant={index === choices.length - 1 ? "primary" : "secondary"}
      disabled={choice.disabled}
      onClick={() => select(choice.id)}
    >
      {choice.label}
    </Button>
  ));
  switch (surface.kind) {
    case "tooltip":
      return (
        <Tooltip content={label} open placement="corner" container={host}>
          {anchor}
        </Tooltip>
      );
    case "menu":
      return (
        <Menu
          {...shared}
          open
          onOpenChange={onOpenChange}
          trigger={anchor}
          items={choices}
          onSelect={select}
          placement="corner"
        />
      );
    case "popover":
      return (
        <Popover
          {...shared}
          open
          onOpenChange={onOpenChange}
          trigger={anchor}
          placement="corner"
        >
          {label && <p className={styles.label}>{label}</p>}
          {text !== undefined && <p className={styles.text}>{text}</p>}
          {choices.map((choice) => (
            <PopoverRow
              key={choice.id}
              disabled={choice.disabled}
              onSelect={() => select(choice.id)}
            >
              {choice.label}
            </PopoverRow>
          ))}
        </Popover>
      );
    case "dialog":
    case "sheet": {
      const Surface = surface.kind === "dialog" ? Dialog : Sheet;
      return (
        <Surface
          {...shared}
          open
          onOpenChange={onOpenChange}
          title={label}
          actions={buttons.length > 0 ? buttons : undefined}
        >
          {text}
        </Surface>
      );
    }
    case "palette":
      return (
        <PaletteSurface
          surface={surface}
          host={host}
          actions={actions}
          onOpenChange={onOpenChange}
          select={select}
        />
      );
    case "notification": {
      // toast 행동은 최대 3개다. 앞의 세 행동만 보인다.
      const [first, second, third] = enabled as ToastAction[];
      return (
        <ToastStack>
          <Toast
            title={label}
            body={text}
            tone={surface.model.tone}
            actions={third
              ? [first, second, third]
              : second
              ? [first, second]
              : first
              ? [first]
              : []}
            onAction={select}
            onClose={actions.close}
            timer={timer}
            clock={clock}
          />
        </ToastStack>
      );
    }
    case "drag":
      return null;
  }
}

const PALETTE_ICONS: Record<PaletteIcon, IconProps["icon"]> = paletteIcons;

// 검색 palette는 검색어를 연 쪽에 돌려주고 연 쪽이 바꾼 행을 같은 표면에 다시 그린다.
// 검색어와 고른 줄은 Palette 안에 남아 행이 바뀌어도 입력이 끊기지 않는다.
function PaletteSurface(
  { surface, host, actions, onOpenChange, select }: {
    surface: OverlaySurface;
    host: HTMLElement;
    actions: SurfaceActions;
    onOpenChange: (open: boolean) => void;
    select: (choiceId: string) => void;
  },
) {
  const [model, setModel] = useState(surface.model);
  useEffect(() => actions.watch((next) => setModel(next.model)), [actions]);
  const items = model.choices.filter((choice) => !choice.disabled).map((
    choice,
  ) => ({
    id: choice.id,
    label: choice.label,
    group: choice.group,
    detail: choice.detail,
    hint: choice.hint,
    icon: choice.icon ? PALETTE_ICONS[choice.icon] : undefined,
  }));
  return (
    <Palette
      container={host}
      returnFocus={false}
      open
      onOpenChange={onOpenChange}
      title={model.label}
      items={items}
      onSelect={select}
      onQueryChange={model.search ? actions.query : undefined}
    />
  );
}

// host마다 React root 하나를 둔다. 지울 때 Radix focus 복귀는 이미 꺼져 있어 focus를 옮기지 않는다.
// main이 연 [Report a problem] 표면은 feedback 통로로만 제출·취소하는 report-problem dialog다.
export function surfaceMount(
  { timer = systemTimer, clock = systemClock, feedback }: {
    timer?: Timer;
    clock?: Clock;
    feedback?: FeedbackDialogApi;
  } = {},
): SurfaceMount {
  return (host, surface, actions) => {
    const root = createRoot(host);
    root.render(
      surface.feedback !== undefined && feedback !== undefined
        ? (
          <FeedbackDialog
            draftRef={surface.feedback}
            problems={surface.feedbackProblems}
            api={feedback}
            host={host}
          />
        )
        : (
          <SurfaceView
            surface={surface}
            host={host}
            actions={actions}
            timer={timer}
            clock={clock}
          />
        ),
    );
    return () => root.unmount();
  };
}
