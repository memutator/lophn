import * as Radix from "@radix-ui/react-dialog";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/wording";
import { useReturnFocus } from "../return-focus.ts";
import { cx } from "../shared.ts";
import parts from "../dialog/dialog.module.css";
import styles from "./palette.module.css";

export interface PaletteItem {
  id: string;
  label: string;
}

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 검색 칸 위의 이름. placeholder를 라벨 대신 쓰지 않는다.
  title: string;
  items: readonly PaletteItem[];
  // 고른 뒤 닫기는 호출자가 open으로 정한다.
  onSelect: (id: string) => void;
  container?: HTMLElement | null;
  // 닫힐 때 연 자리로 focus를 돌린다. 연 자리가 다른 renderer에 있으면 끈다.
  returnFocus?: boolean;
}

function matching(items: readonly PaletteItem[], query: string) {
  const words = query.trim().toLocaleLowerCase();
  if (!words) return items;
  return items.filter((item) => item.label.toLocaleLowerCase().includes(words));
}

// 폭640px·위20%·항목36px. 목록 scrollbar는 항상 보여 남은 항목이 있음을 알린다(R33, R39).
export function Palette(
  {
    open,
    onOpenChange,
    title,
    items,
    onSelect,
    container,
    returnFocus = true,
  }: PaletteProps,
) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputId = useId();
  const focus = useReturnFocus(returnFocus);
  const visible = useMemo(() => matching(items, query), [items, query]);
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
        >
          <Radix.Title asChild>
            <label className={styles.title} htmlFor={inputId}>{title}</label>
          </Radix.Title>
          <input
            id={inputId}
            className={styles.input}
            value={query}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <div ref={list} className={styles.list} role="listbox">
            {visible.length === 0 && (
              <p className={styles.empty}>{t("common.palette.no-results")}</p>
            )}
            {visible.map((item, index) => (
              <div
                key={item.id}
                role="option"
                aria-selected={index === current}
                className={cx(styles.item, index === current && styles.active)}
                onPointerMove={() => setActive(index)}
                onClick={() => onSelect(item.id)}
              >
                {item.label}
              </div>
            ))}
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
