// 새 설계 화면들이 같이 쓰는 탭 줄. project 창의 칸 머리, 앱 공간의 pane 머리, sidebar 위쪽 모양 고르기가 모두 이것이다.
// 기본은 편집기 탭 줄(VS Code Modern 느낌)이다: editor보다 어두운 바탕, 고른 탭은 editor 바탕으로 이어지고 위에 강조선,
// 탭 사이 구분선, 아이콘과 이름, 고른·hover한 탭의 닫기 ×, 저장 안 된 탭의 ●, preview 탭의 italic 이름, 가로 scroll.
// compact는 sidebar의 view 전환 줄이다: 밑줄 글자 탭이 폭을 나눠 갖는다.
import {
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { componentMark, iconPixels } from "@lophn/ui/shared";
import { Tooltip } from "@lophn/ui/overlay";
import {
  dotLabel,
  type TabDot,
  TabStateDot,
} from "../tab-state-dot/tab-state-dot.tsx";
import { TAB_MIME } from "../../shell/tab-strip.tsx";
import styles from "./tab-strip.module.css";

export type { TabDot };

export interface TabItem {
  readonly key: string;
  readonly title: string;
  /** 이름 앞 아이콘. 파일 아이콘, agent profile, vendor 아이콘 등 호출자가 정한다. */
  readonly icon?: ReactNode;
  /** 이름 뒤 상태 점. */
  readonly dot?: TabDot | null;
  /** preview 탭. 이름이 italic이다. */
  readonly preview?: boolean;
  /** 저장 안 된 변경이 있다. 닫기 자리에 ●가 보이고 hover하면 ×가 된다. */
  readonly unsaved?: boolean;
  /** 이름을 바꿀 수 있는 탭. double-click하면 이름 자리가 입력이 된다. */
  readonly renamable?: boolean;
}

type DropMark = { readonly key: string; readonly side: "before" | "after" };

export function TabStrip({
  tabs,
  selected,
  focused = true,
  compact = false,
  onSelect,
  onClose,
  onPin,
  onMenu,
  onReorder,
  renaming = null,
  onRenaming,
  onRename,
  end,
}: {
  tabs: readonly TabItem[];
  selected: string;
  /** 두 칸 중 키보드가 가 있는 칸이다. 고른 탭 강조선이 focus 색이 된다. */
  focused?: boolean;
  /** sidebar 위쪽 같은 작은 줄. 탭이 폭을 나눠 가진다. */
  compact?: boolean;
  onSelect?: (key: string) => void;
  /** 있으면 탭마다 닫기 ×가 생기고 가운데 클릭으로도 닫힌다. */
  onClose?: (key: string) => void;
  /** preview 탭을 double-click하면 고정한다. */
  onPin?: (key: string) => void;
  /** 탭 오른쪽 클릭. 화면 좌표를 준다. */
  onMenu?: (key: string, at: { x: number; y: number }) => void;
  /** 탭을 끌어 놓았다. before 탭 앞에 넣고 null이면 끝이다. 다른 줄에서 끌어 온 탭도 온다. */
  onReorder?: (key: string, before: string | null) => void;
  /** 이름을 바꾸는 중인 탭 key. 탭 menu의 Rename도 이 값으로 입력을 연다. */
  renaming?: string | null;
  /** 이름 바꾸기를 시작(key)하거나 끝냈다(null). */
  onRenaming?: (key: string | null) => void;
  /** 입력을 확정했다. 빈 이름은 null이고 자동 이름으로 돌아간다. */
  onRename?: (key: string, name: string | null) => void;
  /** 줄 끝(새 탭 단추, 칸 닫기 등). */
  end?: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );
  const [drop, setDrop] = useState<DropMark | "end" | null>(null);

  const measure = () => {
    const element = list.current;
    if (!element) return;
    const { scrollWidth, clientWidth, scrollLeft } = element;
    if (scrollWidth <= clientWidth + 1) {
      setThumb((now) => (now === null ? now : null));
      return;
    }
    const next = {
      left: (scrollLeft / scrollWidth) * clientWidth,
      width: (clientWidth * clientWidth) / scrollWidth,
    };
    setThumb((now) =>
      now !== null && now.left === next.left && now.width === next.width
        ? now
        : next,
    );
  };

  // 고른 탭이 줄 밖이면 줄 안에서만 scroll해 보이게 한다.
  useLayoutEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (element && tab) {
      const right = tab.offsetLeft + tab.offsetWidth;
      if (right > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = right - element.clientWidth;
      } else if (tab.offsetLeft < element.scrollLeft) {
        element.scrollLeft = tab.offsetLeft;
      }
    }
    measure();
  }, [selected, tabs]);

  useEffect(() => {
    const element = list.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 가로 scroll 줄이라 세로 wheel도 가로로 옮긴다.
  const onWheel = (event: { deltaX: number; deltaY: number }) => {
    const element = list.current;
    if (!element || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    element.scrollLeft += event.deltaY;
  };

  const dragThumb = (event: PointerEvent<HTMLDivElement>) => {
    const element = list.current;
    if (!element || event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startScroll = element.scrollLeft;
    const ratio = element.scrollWidth / element.clientWidth;
    const move = (next: globalThis.PointerEvent) => {
      element.scrollLeft = startScroll + (next.clientX - startX) * ratio;
    };
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onReorder || !event.dataTransfer.types.includes(TAB_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const over = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-tab-key]",
    );
    if (!over) {
      setDrop("end");
      return;
    }
    const box = over.getBoundingClientRect();
    const side = event.clientX < box.left + box.width / 2 ? "before" : "after";
    setDrop((now) =>
      typeof now === "object" &&
      now !== null &&
      now.key === over.dataset.tabKey &&
      now.side === side
        ? now
        : { key: over.dataset.tabKey!, side },
    );
  };

  const dropped = (event: DragEvent<HTMLDivElement>) => {
    const key = event.dataTransfer.getData(TAB_MIME);
    const mark = drop;
    setDrop(null);
    delete document.documentElement.dataset.tabDragging;
    if (!onReorder || key === "") return;
    event.preventDefault();
    if (mark === null || mark === "end") {
      onReorder(key, null);
      return;
    }
    const at = tabs.findIndex((tab) => tab.key === mark.key);
    onReorder(
      key,
      mark.side === "before" ? mark.key : (tabs[at + 1]?.key ?? null),
    );
  };

  const markOf = (index: number): "before" | "after" | undefined => {
    if (drop === null) return undefined;
    if (drop === "end") return index === tabs.length - 1 ? "after" : undefined;
    return drop.key === tabs[index]!.key ? drop.side : undefined;
  };

  return (
    <div
      className={`${styles.bar} ${compact ? styles.compact : styles.editor}`}
      {...componentMark("TabStrip")}
    >
      <div className={styles.scroller}>
        <div
          ref={list}
          className={styles.list}
          role="tablist"
          onScroll={measure}
          onWheel={onWheel}
          onDragOver={dragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDrop(null);
            }
          }}
          onDrop={dropped}
        >
          {tabs.map((tab, index) => {
            const active = tab.key === selected;
            // 저장 안 된 ●가 닫기 자리를 쓰는 탭은 점을 그리지 않는다.
            const dot = onClose !== undefined && tab.unsaved ? null : tab.dot;
            const editing = tab.key === renaming;
            const tip = tab.dot
              ? t("project-workspace.label.tab-tooltip", {
                  title: tab.title,
                  state: dotLabel(tab.dot),
                })
              : tab.title;
            return (
              <Tooltip
                key={tab.key}
                content={tip}
                open={editing ? false : undefined}
              >
                <div
                  className={[
                    styles.tab,
                    active ? styles.active : "",
                    active && focused ? styles.focused : "",
                    tab.preview ? styles.preview : "",
                    tab.unsaved ? styles.unsaved : "",
                    dot ? styles.dotted : "",
                  ].join(" ")}
                  role="tab"
                  aria-selected={active}
                  data-tab-key={tab.key}
                  data-drop={markOf(index)}
                  draggable={onReorder !== undefined && !editing}
                  onClick={() => onSelect?.(tab.key)}
                  onDoubleClick={() => {
                    if (tab.preview) onPin?.(tab.key);
                    else if (tab.renamable) onRenaming?.(tab.key);
                  }}
                  onMouseDown={(event) => {
                    // 가운데 단추의 자동 scroll을 막는다.
                    if (event.button === 1 && onClose && !editing) {
                      event.preventDefault();
                    }
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1 && onClose && !editing) {
                      event.preventDefault();
                      onClose(tab.key);
                    }
                  }}
                  onContextMenu={(event) => {
                    if (!onMenu || editing) return;
                    event.preventDefault();
                    onMenu(tab.key, { x: event.clientX, y: event.clientY });
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TAB_MIME, tab.key);
                    event.dataTransfer.effectAllowed = "move";
                    document.documentElement.dataset.tabDragging = "";
                  }}
                  onDragEnd={() => {
                    setDrop(null);
                    delete document.documentElement.dataset.tabDragging;
                  }}
                >
                  {tab.icon === undefined ? null : (
                    <span className={styles.icon}>{tab.icon}</span>
                  )}
                  {editing ? (
                    <RenameInput
                      title={tab.title}
                      onDone={(name) => {
                        if (name !== undefined) onRename?.(tab.key, name);
                        onRenaming?.(null);
                      }}
                    />
                  ) : (
                    <span className={styles.title}>{tab.title}</span>
                  )}
                  {onClose === undefined && !dot ? null : (
                    <span className={styles.slot}>
                      {dot ? (
                        <TabStateDot dot={dot} className={styles.dot} />
                      ) : null}
                      {onClose === undefined ? null : (
                        <button
                          type="button"
                          className={styles.close}
                          aria-label={t("common.button.close")}
                          onClick={(event) => {
                            event.stopPropagation();
                            onClose(tab.key);
                          }}
                        >
                          {tab.unsaved ? (
                            <span
                              className={styles.mark}
                              role="img"
                              aria-label={t(
                                "project-workspace.label.tab-unsaved",
                              )}
                            />
                          ) : null}
                          <Icon
                            icon={X}
                            pixels={iconPixels("small")}
                            className={styles.cross}
                          />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </Tooltip>
            );
          })}
        </div>
        {thumb === null ? null : (
          <div className={styles.track} aria-hidden="true">
            <div
              className={styles.thumb}
              style={{ left: thumb.left, width: thumb.width }}
              onPointerDown={dragThumb}
            />
          </div>
        )}
      </div>
      {end === undefined ? null : <div className={styles.end}>{end}</div>}
    </div>
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
      draggable={false}
      onClick={(event) => event.stopPropagation()}
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
