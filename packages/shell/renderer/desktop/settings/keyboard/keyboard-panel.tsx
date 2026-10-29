// Settings › Keyboard. 작업대 단축키를 command마다 한 줄로 보이고 바꾼다. 줄은 이름 아래 작은 설명이 있고, 위의
// 검색 칸이 이름·설명·키로 줄을 거른다. 키 칸을 누르면 그 줄이 새 키를 받고, 받은 키는 바로 저장해 창의
// keybinding service와 main에 덮는다. 번호 줄(n번째 탭, n번째 칸)은 modifier 하나를 받아 모든 번호에 붙인다.
import { type KeyboardEvent, useCallback, useState } from "react";
import { Button, Kbd } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { SearchFilter } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import {
  type ChordCheck,
  checkChord,
  chordLabel,
  chordOfInput,
  type KeyPlatform,
  modifierLabel,
} from "../../../../ipc/keybindings.ts";
import { KEY_CAPTURE_ATTRIBUTE } from "../../../commands/window.ts";
import { useWindowCommands } from "../../../commands/react.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import {
  commandName,
  filterRows,
  type KeyRow,
  keyRows,
  modifierOfInput,
  numberedKeys,
  withKeys,
  withoutPlatform,
} from "./model.ts";
import type { KeyboardSource, StoredKeybindings } from "./source.ts";

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly stored: StoredKeybindings };

const MODIFIERS: Readonly<Record<KeyPlatform, string>> = {
  mac: "⌘, ⌃, or ⌥",
  other: "Ctrl or Alt",
};

function problemText(
  check: Exclude<ChordCheck, { ok: true }>,
  text: string,
  platform: KeyPlatform,
): string {
  switch (check.reason) {
    case "unsupported":
      return t("settings.error.key-unsupported");
    case "needs_modifier":
      return t("settings.error.key-needs-modifier", {
        modifiers: MODIFIERS[platform],
      });
    case "reserved":
      return t("settings.error.key-reserved");
    case "taken":
      return t("settings.error.key-taken", {
        key: chordLabel(text, platform),
        name: commandName(check.by.command),
      });
  }
}

/** 줄의 지금 키를 글로. 검색이 이름·설명과 함께 본다. */
function rowKeyText(row: KeyRow, platform: KeyPlatform): string {
  if (row.kind === "single") {
    return row.chords.map((chord) => chordLabel(chord, platform)).join(" ");
  }
  return row.modifier === null
    ? ""
    : t("settings.label.key-numbered", {
        modifier: modifierLabel(row.modifier, platform),
      });
}

export function KeyboardPanel({ source }: { source: KeyboardSource }) {
  const commands = useWindowCommands();
  const platform: KeyPlatform = commands?.platform ?? "other";
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [notSaved, setNotSaved] = useState(false);

  const load = useCallback(() => {
    void source.read().then((read) => {
      if (!read.ok) {
        setLoaded((prev) =>
          prev.state === "ready" ? prev : { state: "failed" },
        );
        return;
      }
      setLoaded({ state: "ready", stored: read.value });
      commands?.setOverrides(read.value[platform] ?? {});
    });
  }, [source, commands, platform]);
  useReload(source, load);

  async function save(prev: StoredKeybindings, next: StoredKeybindings) {
    setNotSaved(false);
    setLoaded({ state: "ready", stored: next });
    commands?.setOverrides(next[platform] ?? {});
    const saved = await source.write(next);
    if (saved.ok) return;
    setLoaded({ state: "ready", stored: prev });
    commands?.setOverrides(prev[platform] ?? {});
    setNotSaved(true);
  }

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.tab-keyboard")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const stored = loaded.state === "ready" ? loaded.stored : null;
  const overrides = stored?.[platform] ?? {};
  const rows = keyRows(platform, overrides);
  const shown = filterRows(rows, query, (row) => rowKeyText(row, platform));
  const anyChanged = rows.some((row) => row.changed);

  function stop() {
    setEditing(null);
    setProblem(null);
  }

  function capture(
    event: KeyboardEvent<HTMLElement>,
    row: KeyRow,
    current: StoredKeybindings,
  ) {
    // 이 칸의 키는 page의 기본 동작(Tab 이동, 글자 입력)으로도 가지 않는다.
    event.preventDefault();
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.repeat) return;
    const id = row.kind === "single" ? row.id : row.command;
    const ids = row.kind === "single" ? [row.id] : row.ids;
    const plain =
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Escape") return stop();
    if (plain && (event.key === "Backspace" || event.key === "Delete")) {
      stop();
      const cleared =
        row.kind === "single"
          ? { [row.id]: [] }
          : numberedKeys(row.ids, row.numbers, null);
      return void save(current, withKeys(current, platform, cleared));
    }
    const text = chordOfInput({
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
    });
    if (text === null) return;
    const keys =
      row.kind === "single"
        ? { [row.id]: [text] }
        : numberedKeys(row.ids, row.numbers, modifierOfInput(text));
    // 번호 줄은 modifier만 눌러도 숫자 키 하나로 본다. 모든 번호의 키를 하나씩 검사한다.
    for (const chords of Object.values(keys)) {
      const chord = chords[0];
      if (chord === undefined) {
        setProblem({
          id,
          text: t("settings.error.key-numbered-needs-modifier", {
            modifiers: MODIFIERS[platform],
          }),
        });
        return;
      }
      const check = checkChord(chord, ids, platform, current[platform] ?? {});
      if (!check.ok) {
        setProblem({ id, text: problemText(check, chord, platform) });
        return;
      }
    }
    stop();
    void save(current, withKeys(current, platform, keys));
  }

  return (
    <div data-keyboard-settings="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-keyboard")}</h1>
      <p className={styles.lead}>{t("settings.intro.keyboard")}</p>
      <Loading loading={stored === null} placeholder={<Skeleton lines={6} />}>
        {stored === null ? null : (
          <>
            <div className={styles.searchRow}>
              <SearchFilter
                value={query}
                onChange={setQuery}
                label={t("settings.label.key-search")}
              />
            </div>
            {shown.length === 0 ? (
              <p className={styles.lineHelp} data-key-search="empty">
                {t("settings.empty.key-search")}
              </p>
            ) : (
              <ul className={styles.lines}>
                {shown.map((row) => {
                  const id = row.kind === "single" ? row.id : row.command;
                  const resetKeys =
                    row.kind === "single"
                      ? { [row.id]: null }
                      : Object.fromEntries(row.ids.map((one) => [one, null]));
                  return (
                    <li
                      key={id}
                      className={styles.line}
                      data-key-row={id}
                      data-key-changed={row.changed ? "" : undefined}
                    >
                      <div className={styles.lineMain}>
                        <span className={styles.lineName}>{row.name}</span>
                        <span className={styles.lineHelp}>
                          {editing === id
                            ? t(
                                row.kind === "single"
                                  ? "settings.note.key-capture"
                                  : "settings.note.key-capture-numbered",
                              )
                            : row.help}
                        </span>
                        {problem?.id === id ? (
                          <p className={styles.rejected} role="alert">
                            {problem.text}
                          </p>
                        ) : null}
                      </div>
                      <div className={styles.lineControl}>
                        <div className={styles.keyControl}>
                          {editing === id ? (
                            <div
                              className={styles.keyCapture}
                              tabIndex={0}
                              role="textbox"
                              aria-label={t("settings.label.key-capture", {
                                name: row.name,
                              })}
                              {...{ [KEY_CAPTURE_ATTRIBUTE]: "" }}
                              ref={(element) => element?.focus()}
                              onKeyDown={(event) => capture(event, row, stored)}
                              onBlur={stop}
                            >
                              {t("settings.label.key-capture", {
                                name: row.name,
                              })}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={styles.keyButton}
                              aria-label={t("settings.button.key-change", {
                                name: row.name,
                              })}
                              data-key-change={id}
                              onClick={() => {
                                setProblem(null);
                                setEditing(id);
                              }}
                            >
                              <KeyView row={row} platform={platform} />
                            </button>
                          )}
                          {row.changed ? (
                            <Button
                              size="sm"
                              data-key-reset={id}
                              aria-label={t("settings.button.key-reset", {
                                name: row.name,
                              })}
                              onClick={() =>
                                void save(
                                  stored,
                                  withKeys(stored, platform, resetKeys),
                                )
                              }
                            >
                              {t("settings.button.reset-default")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {anyChanged ? (
              <div className={`${styles.endSlot} ${styles.groupBlock}`}>
                <Button
                  data-keys-reset-all=""
                  onClick={() =>
                    void save(stored, withoutPlatform(stored, platform))
                  }
                >
                  {t("settings.button.keys-reset-all")}
                </Button>
              </div>
            ) : null}
          </>
        )}
        {notSaved ? (
          <p className={styles.rejected} role="alert" data-failed="">
            {t("settings.error.value-not-saved")}
          </p>
        ) : null}
      </Loading>
    </div>
  );
}

function KeyView({ row, platform }: { row: KeyRow; platform: KeyPlatform }) {
  if (row.kind === "numbered") {
    if (row.modifier === null) {
      return (
        <span className={styles.lineHelp}>
          {row.changed
            ? t("settings.label.key-numbered-mixed")
            : t("settings.label.key-none")}
        </span>
      );
    }
    const first = row.numbers.find((n) => n !== 0) ?? 1;
    const last = Math.max(...row.numbers);
    const range = row.numbers.includes(0)
      ? "0–9"
      : first === last
        ? `${first}`
        : `${first}–${last}`;
    return <Kbd keys={[`${modifierLabel(row.modifier, platform)}+${range}`]} />;
  }
  if (row.chords.length === 0) {
    return (
      <span className={styles.lineHelp}>{t("settings.label.key-none")}</span>
    );
  }
  return (
    <>
      {row.chords.map((chord) => (
        <Kbd key={chord} keys={[chordLabel(chord, platform)]} />
      ))}
    </>
  );
}
