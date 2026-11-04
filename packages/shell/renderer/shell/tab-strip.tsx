// title bar에 올라가는 tab 줄. 고른 tab은 아래 card와 곡선으로 이어지고(Chrome), group은 tab 2~4개가 한 칸으로
// 붙은 tab 하나다. 줄이 모자랄 때만 group이 아이콘으로 접힌다. 오른쪽 끝에는 접힌 float이 아이콘 칸으로 모인다.
// 데이터와 callback만 받고 model은 모른다.
import {
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";

import { shellIcons } from "../icons/mod.ts";
import {
  dotLabel,
  type TabDot,
  TabStateDot,
} from "../parts/tab-state-dot/tab-state-dot.tsx";
import type { SplitDir } from "./desk-model.ts";
import { type ActiveDrag, useTabDrag } from "./tab-drag.tsx";
import styles from "./tab-strip.module.css";

export interface StripTab {
  readonly key: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly dot?: TabDot | null;
  /** preview tab. 이름이 italic이다. */
  readonly preview?: boolean;
  /** 저장 안 된 변경이 있다. 닫기 자리에 ●가 보이고 hover하면 ×가 된다(상태 점도 같은 자리를 쓴다). */
  readonly unsaved?: boolean;
  /** 이름을 바꿀 수 있는 tab. double-click하면 이름 자리가 입력이 된다. */
  readonly renamable?: boolean;
  /**
   * group의 칸이 돌려 보는 tab들(온 순서, 이 tab 포함). 둘 이상이면 칸의 tab이 모두 차례로 보인다. 고른 group은
   * 이름까지, 고르지 않은 group은 숨은 tab을 아이콘으로 보인다.
   */
  readonly stack?: readonly StripTab[];
}

/** 줄의 한 칸. tab이 둘 이상이면 group이고 한 칸에 붙는다. key는 첫 tab의 key다. */
export interface StripEntry {
  readonly key: string;
  readonly tabs: readonly StripTab[];
  /** 이웃한 두 tab 사이의 나눔 방향(tabs.length - 1개). 반쪽 사이의 작은 표시가 된다. 주지 않으면 row다. */
  readonly dirs?: readonly SplitDir[];
  /** group에서 강조할 tab의 key. */
  readonly focus?: string;
}

export interface TabStripProps {
  entries: readonly StripEntry[];
  /** 고른 칸의 key. */
  selected: string | null;
  /** 접힌 float. 줄 오른쪽 끝에 아이콘 칸으로 보인다. */
  minimized: readonly StripTab[];
  /** minimized 중 지금 펴져 있는 것의 key. 눌린 모양이다. */
  floating: readonly string[];
  /** 누른 tab의 key. 칸의 빈 곳을 누르면 group이면 focus tab이다. */
  onSelect: (tabKey: string) => void;
  /** 닫을 tab의 key. group은 tab마다 자기 닫기 단추가 있어 그 tab만 닫는다. */
  onClose: (tabKey: string) => void;
  /** tab 오른쪽 클릭. tab key(group이면 누른 반쪽)와 화면 좌표. */
  onMenu?: (tabKey: string, at: { x: number; y: number }) => void;
  /** preview tab을 double-click하면 고정한다. */
  onPin?: (tabKey: string) => void;
  /** 이름을 바꾸는 중인 tab key. menu의 Rename도 이 값으로 입력을 연다. */
  renaming?: string | null;
  /** 이름 바꾸기를 시작(key)하거나 끝냈다(null). */
  onRenaming?: (tabKey: string | null) => void;
  /** 입력을 확정했다. 빈 이름은 null이고 자동 이름으로 돌아간다. */
  onRename?: (tabKey: string, name: string | null) => void;
  /** 새 tab 단추 자리. 주지 않으면 onNewTab을 부르는 + 단추다. */
  newTab?: ReactNode;
  onNewTab?: () => void;
  /** 접힌 float을 펴거나 접는다. */
  onToggleFloat: (key: string) => void;
}

// 접힌 칸이 이만큼을 넘으면 나머지는 +N 메뉴로 들어간다. tab이 쓸 폭을 지킨다.
const MINIMIZED_SHOWN = 4;

/** group을 얼마나 접나. groups는 고르지 않은 group, all은 고른 group의 focus 아닌 반쪽까지 아이콘만 보인다. */
type Fold = "groups" | "all" | null;
const FOLDS: readonly Fold[] = [null, "groups", "all"];

export function TabStrip({
  entries,
  selected,
  minimized,
  floating,
  onSelect,
  onClose,
  onMenu,
  onPin,
  renaming = null,
  onRenaming,
  onRename,
  newTab,
  onNewTab,
  onToggleFloat,
}: TabStripProps) {
  const strip = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { active: drag, start } = useTabDrag();
  const [fold, setFold] = useState<Fold>(null);
  // 창 폭이 바뀌면 다시 그려서 아래에서 다시 잰다. 고른 tab의 최대 폭도 이 폭에서 나온다.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const observer = new ResizeObserver(([size]) => {
      if (size) setWidth(size.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // tab이 좁아지기 전 폭으로 줄이 넘치지 않는 가장 덜 접힌 모양을 고른다. 이름, 점, 이름 바꾸기 입력도 폭을 바꾸므로
  // 그릴 때마다 잰다. 끄는 동안은 칸이 비켜서 있으므로 재지 않는다.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || drag !== null) return;
    element.dataset.measure = "";
    const at = FOLDS.findIndex((level) => {
      if (level === null) delete element.dataset.fold;
      else element.dataset.fold = level;
      return element.scrollWidth <= element.clientWidth;
    });
    const pick = at < 0 ? "all" : FOLDS[at]!;
    delete element.dataset.measure;
    if (pick === null) delete element.dataset.fold;
    else element.dataset.fold = pick;
    setFold(pick);
  });

  // 고른 칸이 줄 밖이면 줄 안에서만 scroll해 보이게 한다.
  useLayoutEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !tab) return;
    // 양 끝 곡선(padding)까지 보이게 하고, 줄보다 넓은 tab은 왼쪽 끝을 우선한다.
    const pad = parseFloat(getComputedStyle(element).paddingLeft) || 0;
    const right = tab.offsetLeft + tab.offsetWidth + pad;
    if (right > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = right - element.clientWidth;
    }
    if (tab.offsetLeft - pad < element.scrollLeft) {
      element.scrollLeft = tab.offsetLeft - pad;
    }
  }, [selected, entries, fold]);

  // 세로 wheel도 가로로 옮긴다.
  const onWheel = (event: { deltaX: number; deltaY: number }) => {
    const element = list.current;
    if (!element || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    element.scrollLeft += event.deltaY;
  };

  const slide = drag === null ? null : slideOf(drag);
  // 끌어 온 leaf처럼 줄에 칸이 없는 것은 놓일 자리에 작은 표시만 한다.
  const markOf = (index: number) => {
    if (
      drag === null ||
      drag.origin === "strip" ||
      drag.hit?.kind !== "strip"
    ) {
      return undefined;
    }
    const { before } = drag.hit;
    if (before === null)
      return index === entries.length - 1 ? "after" : undefined;
    return entries[index]!.key === before ? "before" : undefined;
  };

  const shown = minimized.slice(0, MINIMIZED_SHOWN);
  const hidden = minimized.slice(MINIMIZED_SHOWN);

  return (
    <div ref={strip} className={styles.strip} data-tab-strip="">
      <div
        ref={list}
        className={styles.list}
        role="tablist"
        data-fold={fold ?? undefined}
        data-sorting={drag?.origin === "strip" ? "" : undefined}
        onWheel={onWheel}
      >
        {entries.map((entry, index) => {
          const active = entry.key === selected;
          const grouped = entry.tabs.length > 1;
          const focused =
            entry.tabs.find((tab) => tab.key === entry.focus) ?? entry.tabs[0]!;
          return (
            <div
              key={entry.key}
              className={styles.tab}
              role="tab"
              aria-selected={active}
              data-entry-key={entry.key}
              data-active={active || undefined}
              data-split={grouped ? "" : undefined}
              data-drop={markOf(index)}
              data-dragging={
                (drag?.origin === "strip" && drag.item.key === entry.key) ||
                undefined
              }
              style={{
                transform: slide?.get(entry.key)
                  ? `translateX(${slide.get(entry.key)}px)`
                  : undefined,
                // 말도 안 되게 긴 이름만 strip 폭의 80%에서 자른다. CSS %는 tab 폭만큼인 list 기준이라 tab이 하나면
                // 자기 폭의 80%가 되어 늘 잘린다.
                maxWidth: active && width > 0 ? width * 0.8 : undefined,
              }}
              onPointerDown={(event) => {
                if (renaming !== null) return;
                const target = event.target as HTMLElement;
                if (target.closest("button, input")) return;
                // group 칸 안의 tab을 누르면 그 tab 하나를, 칸의 빈 곳(방향 표시, 가장자리)을 누르면 group 통째를 끈다.
                const half = grouped
                  ? target.closest<HTMLElement>("[data-tab-key]")
                  : null;
                if (half?.dataset.tabKey !== undefined) {
                  start(
                    event,
                    { key: half.dataset.tabKey, whole: false },
                    "leaf",
                  );
                } else {
                  start(event, { key: entry.key, whole: grouped }, "strip");
                }
              }}
              onClick={() => onSelect(focused.key)}
              onContextMenu={(event) => {
                if (!onMenu || renaming !== null) return;
                event.preventDefault();
                const half = (event.target as HTMLElement).closest<HTMLElement>(
                  "[data-tab-key]",
                );
                onMenu(half?.dataset.tabKey ?? entry.tabs[0]!.key, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              // 가운데 단추의 자동 scroll을 막는다.
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
            >
              <span className={styles.flareStart} aria-hidden />
              {entry.tabs.map((tab, at) => {
                const items = tab.stack ?? [tab];
                // 끄는 tab을 이 칸 stack의 어디에 넣을지(tab 줄 group 칸 안에 놓을 때).
                const dropAt =
                  drag?.hit?.kind === "stack" && drag.hit.target === tab.key
                    ? drag.hit.index
                    : null;
                const halves = items.map((item, place) => {
                  const editing = item.key === renaming;
                  const one = item.dot
                    ? t("project-workspace.label.tab-tooltip", {
                        title: item.title,
                        state: dotLabel(item.dot),
                      })
                    : item.title;
                  // 이름이 안 보이는 접힌 group은 어느 쪽에 올려도 이름을 다 보인다.
                  const tip =
                    grouped && !active && fold !== null
                      ? entry.tabs
                          .flatMap((half) => half.stack ?? [half])
                          .map((each) => each.title)
                          .join(" | ")
                      : one;
                  return (
                    <Tooltip
                      key={item.key}
                      content={tip}
                      open={editing ? false : undefined}
                    >
                      <span
                        className={styles.half}
                        data-tab-key={item.key}
                        data-focused={
                          (grouped && active && focused.key === item.key) ||
                          undefined
                        }
                        data-hidden={item.key !== tab.key || undefined}
                        data-pane-key={grouped ? tab.key : undefined}
                        data-pane-index={grouped ? place : undefined}
                        data-drop-item={
                          dropAt === place
                            ? "before"
                            : dropAt === items.length &&
                                place === items.length - 1
                              ? "after"
                              : undefined
                        }
                        data-dragging={
                          (drag?.origin === "leaf" &&
                            drag.item.key === item.key) ||
                          undefined
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(item.key);
                        }}
                        onDoubleClick={() => {
                          if (item.preview) onPin?.(item.key);
                          else if (item.renamable) onRenaming?.(item.key);
                        }}
                        onAuxClick={(event) => {
                          if (event.button !== 1 || editing) return;
                          event.preventDefault();
                          onClose(item.key);
                        }}
                      >
                        <span className={styles.icon}>{item.icon}</span>
                        {editing ? (
                          <RenameInput
                            title={item.title}
                            onDone={(name) => {
                              if (name !== undefined) {
                                onRename?.(item.key, name);
                              }
                              onRenaming?.(null);
                            }}
                          />
                        ) : (
                          <span
                            className={styles.title}
                            data-preview={item.preview || undefined}
                          >
                            {item.title}
                          </span>
                        )}
                        <CloseSlot
                          tab={item}
                          onClose={() => onClose(item.key)}
                        />
                      </span>
                    </Tooltip>
                  );
                });
                return (
                  <Fragment key={tab.key}>
                    {at > 0 ? (
                      <span className={styles.splitMark} aria-hidden>
                        <Icon
                          icon={
                            entry.dirs?.[at - 1] === "column"
                              ? shellIcons.splitDown
                              : shellIcons.split
                          }
                          pixels={12}
                        />
                      </span>
                    ) : null}
                    {items.length > 1 ? (
                      <span className={styles.pane}>{halves}</span>
                    ) : (
                      halves
                    )}
                  </Fragment>
                );
              })}
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
          data-float-chips=""
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

// tab 하나의 닫기 단추. 저장 안 된 ●나 상태 점이 있으면 평소에 그것을 보이고, 그 tab에 hover하거나 단추에 focus가
// 오면 ×로 바뀐다. 둘 다 없으면 고른 tab과 hover한 tab에만 ×가 보인다.
function CloseSlot({ tab, onClose }: { tab: StripTab; onClose: () => void }) {
  const unsaved = tab.unsaved === true;
  const dot = !unsaved && tab.dot ? tab.dot : null;
  return (
    <button
      type="button"
      className={styles.close}
      data-unsaved={unsaved || undefined}
      data-dot={dot === null ? undefined : ""}
      aria-label={t("shell.button.strip-close", { title: tab.title })}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      {unsaved ? (
        <span
          className={styles.mark}
          role="img"
          aria-label={t("project-workspace.label.tab-unsaved")}
        />
      ) : null}
      {dot === null ? null : (
        <TabStateDot dot={dot} className={styles.stateDot} />
      )}
      <Icon icon={shellIcons.close} pixels={12} className={styles.cross} />
    </button>
  );
}

// Enter나 blur는 확정(빈 이름은 null), Escape는 취소(undefined)다. unmount 때 blur가 한 번 더 와도 두 번 확정하지 않는다.
function RenameInput({
  title,
  onDone,
}: {
  title: string;
  onDone: (name: string | null | undefined) => void;
}) {
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (name: string | null | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={input}
      className={styles.rename}
      aria-label={t("project-workspace.label.tab-rename")}
      defaultValue={title}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => finish(event.currentTarget.value.trim() || null)}
      onKeyDown={(event) => {
        // 터미널과 작업대 단축키로 키가 새지 않게 한다.
        event.stopPropagation();
        if (event.key === "Enter") {
          finish(event.currentTarget.value.trim() || null);
        } else if (event.key === "Escape") finish(undefined);
      }}
    />
  );
}

/**
 * 끄는 동안 칸마다 옮길 거리(px). 끈 칸은 놓일 자리로 가고(자리 표시), 그 사이 칸들은 한 칸 폭만큼 비켜서 자리를 비운다.
 * 칸 위(card)로 나가면 모두 제자리다. 줄에서 온 끌기만 쓴다.
 */
function slideOf(drag: ActiveDrag): ReadonlyMap<string, number> | null {
  if (drag.origin !== "strip" || drag.hit?.kind !== "strip") return null;
  const from = drag.strip.findIndex((entry) => entry.key === drag.item.key);
  if (from < 0) return null;
  const source = drag.strip[from]!;
  const others = drag.strip.filter((entry) => entry.key !== source.key);
  const before = drag.hit.before;
  const to =
    before === null
      ? others.length
      : others.findIndex((entry) => entry.key === before);
  if (to < 0) return null;
  // 칸 사이 간격. 칸이 하나뿐이면 옮길 일이 없다.
  const gap =
    drag.strip.length > 1
      ? drag.strip[1]!.left - drag.strip[0]!.left - drag.strip[0]!.width
      : 0;
  const moves = new Map<string, number>();
  let travel = 0;
  others.forEach((entry, at) => {
    if (at >= from && at < to) {
      moves.set(entry.key, -(source.width + gap));
      travel += entry.width + gap;
    } else if (at >= to && at < from) {
      moves.set(entry.key, source.width + gap);
      travel -= entry.width + gap;
    }
  });
  moves.set(source.key, travel);
  return moves;
}
