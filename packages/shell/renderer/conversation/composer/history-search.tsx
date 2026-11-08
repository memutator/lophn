// Ctrl+R로 여는 입력 history 검색. composer 위에 slash menu와 같은 상자로 뜬다. 글자를 치면 글 안의 글자로 거르고,
// Enter는 고른 글을 입력칸에 넣고 Escape는 닫는다. 키는 `slashMenu` context가 가져서 입력칸의 보내기로 새지 않는다.
import { t } from "@lophn/i18n";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import menu from "../slash-menu/slash-menu.module.css";
import styles from "./history-search.module.css";

// 목록에 올리는 글의 수. 더 긴 history는 검색어로 좁힌다.
const LIMIT = 50;

interface HistorySearchProps {
  /** 새 것이 앞인 사람 글. */
  history: readonly string[];
  onPick: (text: string) => void;
  onClose: () => void;
}

export function HistorySearch({
  history,
  onPick,
  onClose,
}: HistorySearchProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const needle = query.toLowerCase();
  // 줄의 key는 history 안의 자리다(같은 글이 두 번 있어도 겹치지 않는다).
  const rows = history
    .flatMap((text, at) =>
      text.toLowerCase().includes(needle) ? [{ text, at }] : [],
    )
    .slice(0, LIMIT);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = rows[highlight];
      if (picked !== undefined) onPick(picked.text);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((at) =>
        rows.length === 0 ? 0 : (at + step + rows.length) % rows.length,
      );
    }
  };

  return (
    <div
      className={styles.box}
      data-key-context="slashMenu"
      data-history-search=""
    >
      <input
        ref={input}
        className={styles.search}
        value={query}
        placeholder={t("conversation.label.history-search")}
        aria-label={t("conversation.label.history-search")}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setHighlight(0);
        }}
        onKeyDown={keyDown}
      />
      <div className={styles.list}>
        {rows.length === 0 ? (
          <p className={menu.notice} role="status">
            {t("conversation.notice.history-no-match")}
          </p>
        ) : (
          rows.map((row, at) => (
            <div
              key={row.at}
              role="option"
              className={menu.row}
              aria-selected={at === highlight}
              data-highlighted={at === highlight ? "" : undefined}
              onClick={() => onPick(row.text)}
            >
              <span className={menu.description}>{row.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
