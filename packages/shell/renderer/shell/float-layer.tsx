// card 위에 뜨는 float 패널들. 접힌 것은 호출자가 목록에서 빼고(tab 줄 오른쪽 끝 칸), 여기에는 펴진 것만 온다.
// 이동·resize는 놓을 때만 onRect로 올리고 끄는 동안은 미리보기다.
import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { t } from "@lophn/i18n";
import { type FloatEdge, FloatPanel, Tooltip } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { useObservedSize } from "@lophn/ui/shared";

import { shellIcons } from "../icons/mod.ts";
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
  readonly body: ReactNode;
}

export interface FloatLayerProps {
  /** 아래에서 위 순서. 마지막이 맨 위(active)다. */
  floats: readonly FloatEntry[];
  onRaise: (key: string) => void;
  onRect: (key: string, rect: FloatRect) => void;
  onMinimize: (key: string) => void;
  onDock: (key: string) => void;
  onClose: (key: string) => void;
}

export function FloatLayer(props: FloatLayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const size = useObservedSize(root);
  // 0인 칸은 못 잰 것과 같다. 0x0으로 가둔 rect가 저장되면 layout 저장이 통째로 거절된다.
  const area: FloatArea | undefined =
    size !== undefined && size.width > 0 && size.height > 0 ? size : undefined;
  // raise가 요소를 재배열하면 안의 focus와 scroll(terminal, editor)이 날아가므로 key 순으로 고정하고 z-index로 쌓는다.
  const ordered = props.floats
    .map((float, index) => ({ float, layer: index + 1 }))
    .sort((a, b) => (a.float.key < b.float.key ? -1 : 1));
  return (
    <div ref={root} className={styles.layer} data-floats="">
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
  onClose,
}: FloatLayerProps & {
  float: FloatEntry;
  area: FloatArea;
  layer: number;
  active: boolean;
}) {
  // 이동·resize 중 미리보기. 저장된 rect는 건드리지 않고 그릴 때만 가둔다.
  const [preview, setPreview] = useState<FloatRect | null>(null);
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
      style={{ zIndex: `calc(var(--z-sticky) + ${layer})` }}
    >
      <FloatPanel
        title={float.title}
        icon={float.icon}
        badge={float.dot ? <TabStateDot dot={float.dot} /> : undefined}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        active={active}
        onRaise={() => onRaise(float.key)}
        onMoveStart={(event) =>
          drag(event, (dx, dy) => movedRect(base, dx, dy, area))
        }
        onResizeStart={(edge: FloatEdge, event) =>
          drag(event, (dx, dy) => resizedRect(base, edge, dx, dy, area))
        }
        actions={
          <>
            {action(
              "minimize",
              shellIcons.minimize,
              t("shell.button.float-minimize"),
              () => onMinimize(float.key),
            )}
            {action("dock", shellIcons.dock, t("shell.button.float-dock"), () =>
              onDock(float.key),
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
        <div className={styles.body}>{float.body}</div>
      </FloatPanel>
    </div>
  );
}
