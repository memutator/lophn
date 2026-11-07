// 창 몸통(title bar 아래, 양쪽 sidebar 포함) 위에 뜨는 float 패널들. 접힌 것은 호출자가 목록에서 빼고(작업 표시줄이나 tab 줄
// 끝의 chip), 여기에는 펴진 것만 온다. 이동·resize는 놓을 때만 onRect로 올리고 끄는 동안은 미리보기다.
// 고정 안 한 패널은 그 패널 밖을 누르면 접힌다(onOutside). 고정한 패널은 늘 위에 남는다.
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { type FloatEdge, FloatPanel, Tooltip } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";

import {
  HeadControls,
  HeadSlotScope,
  useHeadSlot,
} from "../app-frame/app-tab-head.tsx";
import { ViewLayerProvider } from "../app-frame/webview-host.tsx";
import { actionIcons, browserIcons, shellIcons } from "../icons/mod.ts";
import {
  TabStateDot,
  type TabDot,
} from "../parts/tab-state-dot/tab-state-dot.tsx";
import { startPointerDrag } from "../workspace/drag.ts";
import {
  clampFloatRect,
  type FloatArea,
  type FloatRect,
  movedRect,
  resizedRect,
} from "../workspace/model.ts";
import styles from "./float-layer.module.css";

export interface FloatEntry {
  /** tab key. */
  readonly key: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly dot?: TabDot | null;
  /** layer(stage) 왼쪽 위 기준 CSS px. */
  readonly rect: FloatRect;
  /** 고정(always on top). */
  readonly pinned: boolean;
  /** 앱 panel 화면만 준다. false면 desk float(모든 workspace로 옮길 수 있다), true면 전역 float(이 desk로 옮긴다). 없으면 옮기는 단추가 없다. */
  readonly global?: boolean;
  /** 본문이 앱 화면이면 true. 앱이 useTabHead로 올린 머리 줄을 이 패널의 bar에 그린다. */
  readonly appHead?: boolean;
  readonly body: ReactNode;
}

export interface FloatLayerProps {
  /** 층 root. 호출자가 같은 ref로 크기를 재서 새 패널의 자리도 정한다. */
  layerRef: RefObject<HTMLDivElement | null>;
  /** layerRef의 크기. 못 쟀거나 0이면 undefined이고 패널을 그리지 않는다. */
  area: FloatArea | undefined;
  /** 아래에서 위 순서. 마지막이 맨 위(active)다. */
  floats: readonly FloatEntry[];
  onRaise: (key: string) => void;
  onRect: (key: string, rect: FloatRect) => void;
  onMinimize: (key: string) => void;
  /** 없으면 dock 단추와 bar 더블클릭이 없다(전역 float은 한 desk의 tab이 될 수 없다). */
  onDock?: (key: string) => void;
  /** desk float ↔ 전역 float을 옮긴다. 없으면 옮기는 단추가 없다. */
  onGlobal?: (key: string) => void;
  onClose: (key: string) => void;
  onPin: (key: string, pinned: boolean) => void;
  /** 패널 밖을 눌렀다. 누른 곳이 어느 패널 안이면 그 key다(그 패널은 남는다). */
  onOutside: (inside: string | undefined) => void;
}

// 패널에서 연 menu·dialog(portal이라 패널 DOM 밖)와 float chip 묶음은 "밖"이 아니다. chip은 누르면 그
// 패널을 접고 펴는 자리라 여기서 먼저 접으면 다시 펴진다.
const NOT_OUTSIDE =
  "[data-radix-popper-content-wrapper], [role=dialog], [role=menu], [role=listbox], [data-float-chips]";

function useOutsidePress(onOutside: (inside: string | undefined) => void) {
  const latest = useRef(onOutside);
  latest.current = onOutside;
  useEffect(() => {
    const press = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || target.closest(NOT_OUTSIDE)) return;
      latest.current(
        target.closest<HTMLElement>("[data-float-key]")?.dataset.floatKey,
      );
    };
    // <webview> 안의 click은 embedder로 오지 않고, webview 그릇이 그 자리에 focusin을 대신 쏜다(isTrusted가 false).
    // 사람이 옮긴 진짜 focus는 pointerdown이 이미 봤고, 코드가 옮긴 focus로는 접지 않는다.
    const webviewFocus = (event: Event) => {
      if (!event.isTrusted) press(event);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("focusin", webviewFocus, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("focusin", webviewFocus, true);
    };
  }, []);
}

export function FloatLayer(props: FloatLayerProps) {
  const { area } = props;
  useOutsidePress(props.onOutside);
  // raise가 요소를 재배열하면 안의 focus와 scroll(terminal, editor)이 날아가므로 key 순으로 고정하고 z-index로 쌓는다.
  const ordered = props.floats
    .map((float, index) => ({ float, layer: index + 1 }))
    .sort((a, b) => (a.float.key < b.float.key ? -1 : 1));
  return (
    <div ref={props.layerRef} className={styles.layer} data-floats="">
      {area === undefined
        ? null
        : ordered.map(({ float, layer }) => (
            <FloatEntryView
              key={float.key}
              {...props}
              float={float}
              area={area}
              layer={layer}
              active={layer === props.floats.length}
            />
          ))}
    </div>
  );
}

function FloatEntryView({
  float,
  area,
  layer,
  active,
  onRaise,
  onRect,
  onMinimize,
  onDock,
  onGlobal,
  onClose,
  onPin,
}: FloatLayerProps & {
  float: FloatEntry;
  area: FloatArea;
  layer: number;
  active: boolean;
}) {
  // 이동·resize 중 미리보기. 저장된 rect는 건드리지 않고 그릴 때만 가둔다.
  const [preview, setPreview] = useState<FloatRect | null>(null);
  const [head, setHead] = useHeadSlot();
  const base = clampFloatRect(float.rect, area);
  const rect = preview ?? base;

  const drag = (
    event: PointerEvent<HTMLElement>,
    next: (dx: number, dy: number) => FloatRect,
  ) => {
    let last: FloatRect | null = null;
    startPointerDrag(event, {
      move: (dx, dy) => {
        last = next(dx, dy);
        setPreview(last);
      },
      finish: (outcome) => {
        setPreview(null);
        if (outcome.type === "drag-end" && last !== null) {
          onRect(float.key, last);
        }
      },
    });
  };

  const action = (
    id: string,
    icon: (typeof shellIcons)[keyof typeof shellIcons],
    label: string,
    run: () => void,
  ) => (
    <Tooltip content={label}>
      <IconButton
        icon={icon}
        label={label}
        size="sm"
        data-float-action={id}
        onClick={run}
      />
    </Tooltip>
  );

  return (
    <div
      className={styles.slot}
      data-float-key={float.key}
      // 층 L의 패널은 --z-sticky + 2L이다. 그 사이 +1에 floated 화면의 <webview>가 온다(app-frame/webview-host).
      style={{ zIndex: `calc(var(--z-sticky) + ${layer * 2})` }}
    >
      <FloatPanel
        title={float.title}
        icon={float.icon}
        badge={
          <>
            {float.dot ? <TabStateDot dot={float.dot} /> : null}
            {/* 제목과 단추 사이의 남는 자리. 앱의 머리 줄이 좁으면 먼저 줄어든다. */}
            {float.appHead ? (
              <span className={styles.head}>
                <HeadControls spec={head} />
              </span>
            ) : null}
          </>
        }
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        active={active}
        onRaise={() => onRaise(float.key)}
        onMoveStart={(event) =>
          drag(event, (dx, dy) => movedRect(base, dx, dy, area))
        }
        onBarDoubleClick={onDock && (() => onDock(float.key))}
        onResizeStart={(edge: FloatEdge, event) =>
          drag(event, (dx, dy) => resizedRect(base, edge, dx, dy, area))
        }
        actions={
          <>
            {onGlobal === undefined || float.global === undefined
              ? null
              : float.global
                ? action(
                    "to-desk",
                    actionIcons.openInTab,
                    t("shell.button.float-to-desk"),
                    () => onGlobal(float.key),
                  )
                : action(
                    "to-global",
                    browserIcons.globe,
                    t("shell.button.float-to-global"),
                    () => onGlobal(float.key),
                  )}
            {float.pinned
              ? action(
                  "unpin",
                  shellIcons.pin,
                  t("shell.button.float-unpin"),
                  () => onPin(float.key, false),
                )
              : action("pin", shellIcons.pin, t("shell.button.float-pin"), () =>
                  onPin(float.key, true),
                )}
            {action(
              "minimize",
              shellIcons.minimize,
              t("shell.button.float-minimize"),
              () => onMinimize(float.key),
            )}
            {onDock === undefined
              ? null
              : action(
                  "dock",
                  shellIcons.dock,
                  t("shell.button.float-dock"),
                  () => onDock(float.key),
                )}
            {action(
              "close",
              shellIcons.close,
              t("shell.button.float-close"),
              () => onClose(float.key),
            )}
          </>
        }
      >
        <ViewLayerProvider value={layer}>
          <div className={styles.body}>
            {float.appHead ? (
              <HeadSlotScope set={setHead}>{float.body}</HeadSlotScope>
            ) : (
              float.body
            )}
          </div>
        </ViewLayerProvider>
      </FloatPanel>
    </div>
  );
}
