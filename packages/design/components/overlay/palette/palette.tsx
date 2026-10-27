import * as Radix from "@radix-ui/react-dialog";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { t } from "@lophn/wording";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Kbd } from "../../primitives/kbd/kbd.tsx";
import { useReturnFocus } from "../return-focus.ts";
import { componentMark, cx, iconPixels } from "../../_shared/shared.ts";
import parts from "../dialog/dialog.module.css";
import styles from "./palette.module.css";

export interface PaletteItem {
  id: string;
  label: string;
  // 같은 묶음 이름이 이어지는 행은 그 이름 아래에 모인다. 순서는 호출자가 정한다.
  group?: string;
  // 이름 옆의 흐린 보조 글(자리·종류).
  detail?: string;
  // 행 오른쪽의 키 이름. 호출자가 플랫폼에 맞게 쓴다.
  hint?: string;
  icon?: LucideIcon;
  // icon 자리에 대신 그릴 작은 이미지(data URL, 예: site favicon). 장식이라 이름은 label이 맡는다.
  image?: string;
}

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 검색 칸 위의 이름. placeholder를 라벨 대신 쓰지 않는다.
  title: string;
  items: readonly PaletteItem[];
  // 고른 뒤 닫기는 호출자가 open으로 정한다.
  onSelect: (id: string) => void;
  // 주면 검색어를 호출자에게 넘기고 items를 거르지 않는다. 호출자가 맞는 행을 다시 준다.
  onQueryChange?: (query: string) => void;
  container?: HTMLElement | null;
  // 닫힐 때 연 자리로 focus를 돌린다. 연 자리가 다른 renderer에 있으면 끈다.
  returnFocus?: boolean;
}

function matching(items: readonly PaletteItem[], query: string) {
  const words = query.trim().toLocaleLowerCase();
  if (!words) return items;
  return items.filter((item) => item.label.toLocaleLowerCase().includes(words));
}

// 폭640px·위12%·항목36px. 목록 scrollbar는 항상 보여 남은 항목이 있음을 알린다.
export function Palette({
  open,
  onOpenChange,
  title,
  items,
  onSelect,
  onQueryChange,
  container,
  returnFocus = true,
}: PaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputId = useId();
  const focus = useReturnFocus(returnFocus);
  const visible = useMemo(
    () => (onQueryChange ? items : matching(items, query)),
    [items, query, onQueryChange],
  );
  const current = Math.min(active, Math.max(visible.length - 1, 0));
  const list = useRef<HTMLDivElement>(null);
  // 키보드로 고른 행이 목록 밖에 있으면 보이게 옮긴다. focus는 검색 칸에 남는다.
  useEffect(() => {
    list.current?.querySelector("[aria-selected=true]")?.scrollIntoView({
      block: "nearest",
    });
  }, [current, visible]);
  const move = (step: number) => {
    if (visible.length === 0) return;
    setActive((current + step + visible.length) % visible.length);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter" && visible[current]) {
      onSelect(visible[current].id);
    } else return;
    event.preventDefault();
  };
  const rows = visible.map((item, index) => {
    const heading =
      item.group !== undefined && item.group !== visible[index - 1]?.group;
    return (
      <div key={item.id} role="presentation">
        {heading && (
          <div className={styles.group} role="presentation">
            {item.group}
          </div>
        )}
        <div
          role="option"
          aria-selected={index === current}
          className={cx(styles.item, index === current && styles.active)}
          onPointerMove={() => setActive(index)}
          onClick={() => onSelect(item.id)}
        >
          {item.image !== undefined ? (
            <img
              className={cx(styles.icon, styles.image)}
              src={item.image}
              alt=""
              width={iconPixels("base")}
              height={iconPixels("base")}
            />
          ) : (
            item.icon && (
              <Icon
                icon={item.icon}
                pixels={iconPixels("base")}
                className={styles.icon}
              />
            )
          )}
          <span className={styles.text}>
            <span className={styles.label}>{item.label}</span>
            {item.detail && (
              <span className={styles.detail}>{item.detail}</span>
            )}
          </span>
          {item.hint && <span className={styles.hint}>{item.hint}</span>}
        </div>
      </div>
    );
  });
  return (
    <Radix.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setActive(0);
        }
        onOpenChange(next);
      }}
    >
      <Radix.Portal container={container}>
        <Radix.Overlay className={parts.backdrop} />
        <Radix.Content
          className={styles.palette}
          aria-describedby={undefined}
          {...focus}
          {...componentMark("Palette")}
        >
          <Radix.Title asChild>
            <label className={styles.title} htmlFor={inputId}>
              {title}
            </label>
          </Radix.Title>
          <div className={styles.search}>
            <Icon
              icon={Search}
              pixels={iconPixels("base")}
              className={styles.icon}
            />
            <input
              id={inputId}
              className={styles.input}
              value={query}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                onQueryChange?.(event.target.value);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div ref={list} className={styles.list} role="listbox">
            {visible.length === 0 && (
              <p className={styles.empty}>{t("common.palette.no-results")}</p>
            )}
            {rows}
          </div>
          <div className={styles.footer} aria-hidden="true">
            <span className={styles.key}>
              <Kbd keys={["↑", "↓"]} />
              {t("common.label.palette-key-move")}
            </span>
            <span className={styles.key}>
              <Kbd keys={["↵"]} />
              {t("common.label.palette-key-open")}
            </span>
            <span className={styles.key}>
              <Kbd keys={["Esc"]} />
              {t("common.label.palette-key-close")}
            </span>
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
