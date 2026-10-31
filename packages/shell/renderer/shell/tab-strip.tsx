// title bar에 올라가는 tab 줄. 고른 tab은 아래 card와 곡선으로 이어지고(Chrome), split은 두 tab이 한 칸으로 붙은
// tab 하나다. 오른쪽 끝에는 접힌 float이 아이콘 칸으로 모인다. 데이터와 callback만 받고 model은 모른다.
import {
  type DragEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";

import { shellIcons } from "../icons/mod.ts";
import { TAB_MIME } from "../parts/tab-strip/tab-strip.tsx";
import {
  type TabDot,
  TabStateDot,
} from "../parts/tab-state-dot/tab-state-dot.tsx";
import styles from "./tab-strip.module.css";

export type Side = "a" | "b";

export interface StripTab {
  readonly key: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly dot?: TabDot | null;
}

/** 줄의 한 칸. b가 있으면 split이고 a·b 두 tab이 한 칸에 붙는다. key는 a의 key다. */
export interface StripEntry {
  readonly key: string;
  readonly a: StripTab;
  readonly b?: StripTab;
}

export interface TabStripProps {
  entries: readonly StripEntry[];
  /** 고른 칸의 key. */
  selected: string | null;
  /** 고른 칸이 split일 때 강조할 쪽. */
  focus: Side;
  /** 접힌 float. 줄 오른쪽 끝에 아이콘 칸으로 보인다. */
  minimized: readonly StripTab[];
  /** minimized 중 지금 펴져 있는 것의 key. 눌린 모양이다. */
  floating: readonly string[];
  onSelect: (key: string, side: Side) => void;
  /** 닫을 tab의 key(split의 반쪽이면 그 반쪽). 닫기 단추는 split에서 focus 쪽을 닫는다. */
  onClose: (tabKey: string) => void;
  /** 새 tab 단추 자리. 주지 않으면 onNewTab을 부르는 + 단추다. */
  newTab?: ReactNode;
  onNewTab?: () => void;
  /** 칸을 끌어 놓았다. before 칸 앞에 넣고 null이면 끝이다. */
  onReorder: (key: string, before: string | null) => void;
  /** 접힌 float을 펴거나 접는다. */
  onToggleFloat: (key: string) => void;
}

// 접힌 칸이 이만큼을 넘으면 나머지는 +N 메뉴로 들어간다. tab이 쓸 폭을 지킨다.
const MINIMIZED_SHOWN = 4;

type Drop = { key: string; side: "before" | "after" } | "end";

export function TabStrip({
  entries,
  selected,
  focus,
  minimized,
  floating,
  onSelect,
  onClose,
  newTab,
  onNewTab,
  onReorder,
  onToggleFloat,
}: TabStripProps) {
  const list = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  // 고른 칸이 줄 밖이면 줄 안에서만 scroll해 보이게 한다.
  useLayoutEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !tab) return;
    const right = tab.offsetLeft + tab.offsetWidth;
    if (right > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = right - element.clientWidth;
    } else if (tab.offsetLeft < element.scrollLeft) {
      element.scrollLeft = tab.offsetLeft;
    }
  }, [selected, entries]);

  // 세로 wheel도 가로로 옮긴다.
  const onWheel = (event: { deltaX: number; deltaY: number }) => {
    const element = list.current;
    if (!element || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    element.scrollLeft += event.deltaY;
  };

  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(TAB_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const over = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-entry-key]",
    );
    if (!over) {
      setDrop("end");
      return;
    }
    const box = over.getBoundingClientRect();
    const side = event.clientX < box.left + box.width / 2 ? "before" : "after";
    const key = over.dataset.entryKey!;
    setDrop((now) =>
      typeof now === "object" && now?.key === key && now.side === side
        ? now
        : { key, side },
    );
  };

  const dropped = (event: DragEvent<HTMLDivElement>) => {
    const key = event.dataTransfer.getData(TAB_MIME);
    const mark = drop;
    setDrop(null);
    delete document.documentElement.dataset.tabDragging;
    if (key === "") return;
    event.preventDefault();
    if (mark === null || mark === "end") {
      onReorder(key, null);
      return;
    }
    const at = entries.findIndex((entry) => entry.key === mark.key);
    onReorder(
      key,
      mark.side === "before" ? mark.key : (entries[at + 1]?.key ?? null),
    );
  };

  const markOf = (index: number) => {
    if (drop === null) return undefined;
    if (drop === "end") {
      return index === entries.length - 1 ? "after" : undefined;
    }
    return drop.key === entries[index]!.key ? drop.side : undefined;
  };

  const shown = minimized.slice(0, MINIMIZED_SHOWN);
  const hidden = minimized.slice(MINIMIZED_SHOWN);

  return (
    <div className={styles.strip}>
      <div
        ref={list}
        className={styles.list}
        role="tablist"
        onWheel={onWheel}
        onDragOver={dragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDrop(null);
          }
        }}
        onDrop={dropped}
      >
        {entries.map((entry, index) => {
          const active = entry.key === selected;
          const halves: readonly [Side, StripTab][] =
            entry.b === undefined
              ? [["a", entry.a]]
              : [
                  ["a", entry.a],
                  ["b", entry.b],
                ];
          const closing =
            active && focus === "b" && entry.b ? entry.b : entry.a;
          return (
            <div
              key={entry.key}
              className={styles.tab}
              role="tab"
              aria-selected={active}
              data-entry-key={entry.key}
              data-active={active || undefined}
              data-split={entry.b === undefined ? undefined : ""}
              data-drop={markOf(index)}
              draggable
              onClick={() => onSelect(entry.key, "a")}
              // 가운데 단추의 자동 scroll을 막는다.
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(TAB_MIME, entry.key);
                event.dataTransfer.effectAllowed = "move";
                document.documentElement.dataset.tabDragging = "";
              }}
              onDragEnd={() => {
                setDrop(null);
                delete document.documentElement.dataset.tabDragging;
              }}
            >
              <span className={styles.flareStart} aria-hidden />
              {halves.map(([side, tab]) => (
                <span
                  key={side}
                  className={styles.half}
                  data-focused={
                    (entry.b !== undefined && active && focus === side) ||
                    undefined
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(entry.key, side);
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    onClose(tab.key);
                  }}
                >
                  <span className={styles.icon}>{tab.icon}</span>
                  <span className={styles.title}>{tab.title}</span>
                  {tab.dot ? <TabStateDot dot={tab.dot} /> : null}
                </span>
              ))}
              <button
                type="button"
                className={styles.close}
                aria-label={t("shell.button.strip-close", {
                  title: closing.title,
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(closing.key);
                }}
              >
                <Icon icon={shellIcons.close} pixels={12} />
              </button>
              <span className={styles.flareEnd} aria-hidden />
            </div>
          );
        })}
      </div>

      <span className={styles.newTab}>
        {newTab ?? (
          <IconButton
            icon={shellIcons.add}
            label={t("shell.button.new-tab")}
            size="sm"
            onClick={onNewTab}
          />
        )}
      </span>
      <span className={styles.drag} />

      {minimized.length === 0 ? null : (
        <div
          className={styles.minimized}
          role="group"
          aria-label={t("shell.label.minimized")}
        >
          {shown.map((tab) => (
            <Tooltip key={tab.key} content={tab.title}>
              <button
                type="button"
                className={styles.chip}
                aria-label={tab.title}
                aria-pressed={floating.includes(tab.key)}
                onClick={() => onToggleFloat(tab.key)}
              >
                {tab.icon}
              </button>
            </Tooltip>
          ))}
          {hidden.length === 0 ? null : (
            <Menu
              placement="corner"
              onSelect={onToggleFloat}
              items={hidden.map((tab) => ({
                id: tab.key,
                label: tab.title,
                leading: <MenuIcon>{tab.icon}</MenuIcon>,
              }))}
              trigger={
                <button
                  type="button"
                  className={styles.chip}
                  data-minimized-more=""
                  aria-label={t("shell.button.minimized-more", {
                    count: hidden.length,
                  })}
                >
                  +{hidden.length}
                </button>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
