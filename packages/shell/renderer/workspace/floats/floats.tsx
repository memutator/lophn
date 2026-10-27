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
import { TabStateDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
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
  /** focus가 floats 층에 있는지. false면 맨 위 패널도 focus 색이 아니다. */
  focused: boolean;
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
  /** 없으면 [Detach] 단추를 두지 않는다. */
  onDetach?(key: string): void;
  /** Detach할 수 있는 탭인지. 없으면 모두 할 수 있다. */
  canDetach?(tab: TabItem): boolean;
  onClose(key: string): void;
  /**
   * browser 탭의 <webview> 그릇. 패널과 같은 stacking context에 있어야 floated browser 탭이 자기
   * 패널 바로 위에 온다. 옮기면 page가 다시 load되므로 패널이 없을 때도 늘 같은 자리에 둔다.
   */
  webviews?: ReactNode;
}

export function Floats(props: FloatsProps): ReactElement {
  const { floats, area } = props;
  // 0인 칸은 못 잰 것과 같다. 0x0으로 가둔 rect가 저장되면 layout 저장이 통째로 거절된다.
  const measured = area !== undefined && area.width > 0 && area.height > 0;
  const top = floats.findLastIndex((item) => !item.minimized);
  // raise가 요소를 재배열하면 안의 focus와 scroll(terminal, editor)이 날아가므로 key 순으로 고정한다.
  const ordered = floats
    .map((item, index) => ({ item, layer: index + 1 }))
    .sort((a, b) => (a.item.tab.key < b.item.tab.key ? -1 : 1));
  return (
    <div className={styles.floats} data-floats="">
      {props.webviews}
      {measured
        ? ordered.map(({ item, layer }) => (
            <FloatEntry
              key={item.tab.key}
              {...props}
              item={item}
              area={area}
              layer={layer}
              active={props.focused && layer - 1 === top}
            />
          ))
        : null}
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

function FloatEntry({
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
  onDetach,
  canDetach,
  onClose,
}: FloatEntryProps) {
  const { tab } = item;
  const strip = stripTab(tab);
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
    // 층 L의 패널은 z-index --z-sticky + 2L이다. 그 사이 +1에 floated browser 탭의 <webview>가 온다(webview-host).
    <div
      className={styles.layer}
      style={{ zIndex: `calc(var(--z-sticky) + ${layer * 2})` }}
    >
      <FloatPanel
        ref={ref}
        title={tab.title}
        icon={strip.icon}
        badge={strip.dot ? <TabStateDot dot={strip.dot} /> : undefined}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        active={active}
        hidden={item.minimized}
        onRaise={() => onRaise(tab.key)}
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
            {onDetach && !item.minimized && (canDetach?.(tab) ?? true)
              ? action(
                  "detach",
                  workspaceIcons.detach,
                  t("project-workspace.button.float-detach"),
                  () => onDetach(tab.key),
                )
              : null}
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
          {kept !== null ? (
            <div className={styles.kept}>{kept}</div>
          ) : (
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
