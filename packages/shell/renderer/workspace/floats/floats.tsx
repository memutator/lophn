import {
  type ComponentProps,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type FloatEdge, FloatPanel, Tooltip } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";

import type { TabItem as StripTab } from "../../parts/tab-strip/tab-strip.tsx";
import {
  useViewCover,
  ViewLayerProvider,
} from "../../app-frame/embedded-view.tsx";
import { workspaceIcons } from "../../icons/mod.ts";
import {
  clampFloatRect,
  type FloatArea,
  type FloatItem,
  type FloatRect,
  movedRect,
  resizedRect,
  type TabItem,
} from "../model.ts";
import { startPointerDrag } from "../drag.ts";
import styles from "./floats.module.css";

interface FloatsProps {
  floats: readonly FloatItem[];
  /** `.content`의 크기. 아직 못 쟀으면 undefined이고 아무것도 그리지 않는다. */
  area: FloatArea | undefined;
  /** 제목 앞 아이콘 등 탭 줄이 그리는 모양(workspace의 stripTab). */
  stripTab: (tab: TabItem) => StripTab;
  /** workspace의 renderTab / renderKept. */
  renderTab: (tab: TabItem, active: boolean) => ReactNode | null;
  renderKept: (tab: TabItem, shown: boolean) => ReactNode | null;
  onRaise(key: string): void;
  onRect(key: string, rect: FloatRect): void;
  onMinimize(key: string): void;
  onDock(key: string): void;
  onClose(key: string): void;
}

export function Floats(props: FloatsProps): ReactElement | null {
  const { floats, area } = props;
  // 0인 칸은 못 잰 것과 같다. 0x0으로 가둔 rect가 저장되면 layout 저장이 통째로 거절된다.
  if (area === undefined || area.width === 0 || area.height === 0) {
    return null;
  }
  const top = floats.findLastIndex((item) => !item.minimized);
  // raise가 요소를 재배열하면 안의 focus와 scroll(terminal, editor)이 날아가므로 key 순으로 고정한다.
  const ordered = floats
    .map((item, index) => ({ item, layer: index + 1 }))
    .sort((a, b) => a.item.tab.key < b.item.tab.key ? -1 : 1);
  return (
    <div className={styles.floats} data-floats="">
      {ordered.map(({ item, layer }) => (
        <FloatEntry
          key={item.tab.key}
          {...props}
          item={item}
          area={area}
          layer={layer}
          active={layer - 1 === top}
        />
      ))}
    </div>
  );
}

interface FloatEntryProps extends FloatsProps {
  item: FloatItem;
  area: FloatArea;
  /** floats 배열 index + 1. */
  layer: number;
  active: boolean;
}

function FloatEntry(
  {
    item,
    area,
    layer,
    active,
    stripTab,
    renderTab,
    renderKept,
    onRaise,
    onRect,
    onMinimize,
    onDock,
    onClose,
  }: FloatEntryProps,
) {
  const { tab } = item;
  // 이동·resize 중 미리보기. 놓을 때만 onRect로 올린다.
  const [preview, setPreview] = useState<FloatRect | null>(null);
  // 저장된 rect는 건드리지 않고 그릴 때만 가둔다. 창이 줄었다 커지면 원래 자리로 돌아온다.
  const base = clampFloatRect(item.rect, area);
  const rect = preview ?? base;
  const ref = useRef<HTMLElement>(null);
  const coverChanged = useViewCover(ref, !item.minimized, layer);
  // 옮기는 동안 native view가 비켜 가도록 크기 변화 없는 이동도 알린다.
  useLayoutEffect(() => {
    coverChanged();
  }, [coverChanged, rect.x, rect.y, rect.width, rect.height]);

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
        if (outcome.type === "drag-end" && last !== null) onRect(tab.key, last);
      },
    });
  };

  const kept = renderKept(tab, !item.minimized);
  if (kept === null && item.minimized) return null;
  const action = (
    id: string,
    icon: ComponentProps<typeof IconButton>["icon"],
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
    <div className={styles.layer} style={{ zIndex: layer }}>
      <FloatPanel
        ref={ref}
        title={tab.title}
        icon={stripTab(tab).icon}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        active={active}
        hidden={item.minimized}
        onRaise={active ? undefined : () => onRaise(tab.key)}
        onMoveStart={(event) =>
          drag(event, (dx, dy) => movedRect(base, dx, dy, area))}
        onResizeStart={(edge: FloatEdge, event) =>
          drag(event, (dx, dy) => resizedRect(base, edge, dx, dy, area))}
        actions={
          <>
            {action(
              "minimize",
              workspaceIcons.minimize,
              t("project-workspace.button.float-minimize"),
              () => onMinimize(tab.key),
            )}
            {action(
              "dock",
              workspaceIcons.dock,
              t("project-workspace.button.float-dock"),
              () => onDock(tab.key),
            )}
            {action(
              "close",
              workspaceIcons.close,
              t("project-workspace.button.float-close"),
              () => onClose(tab.key),
            )}
          </>
        }
      >
        <ViewLayerProvider value={layer}>
          {kept !== null
            ? <div className={styles.kept}>{kept}</div>
            : (
              <div className={styles.body}>
                {renderTab(tab, active) ?? (
                  <h1 className={styles.heading}>{tab.title}</h1>
                )}
              </div>
            )}
        </ViewLayerProvider>
      </FloatPanel>
    </div>
  );
}
