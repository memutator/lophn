// Settings › Keyboard. 작업대 단축키를 줄마다 보이고 바꾼다. [Change]를 누르면 그 줄이 새 키를 받고, 받은 키는
// 바로 저장해 창의 keybinding service와 main에 덮는다. 바꾸는 것은 이 기기 OS의 키뿐이다.
import { type KeyboardEvent, useCallback, useState } from "react";
import { Button, Kbd } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import {
  type ChordCheck,
  checkChord,
  chordLabel,
  chordOfInput,
  type KeyPlatform,
} from "../../../../ipc/keybindings.ts";
import { KEY_CAPTURE_ATTRIBUTE } from "../../../commands/window.ts";
import { useWindowCommands } from "../../../commands/react.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { bindingName, keyRows, withChords, withoutPlatform } from "./model.ts";
import type { KeyboardSource, StoredKeybindings } from "./source.ts";

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly stored: StoredKeybindings };

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
        modifiers: platform === "mac" ? "⌘, ⌃, or ⌥" : "Ctrl or Alt",
      });
    case "reserved":
      return t("settings.error.key-reserved");
    case "taken":
      return t("settings.error.key-taken", {
        key: chordLabel(text, platform),
        name: bindingName(check.by),
      });
  }
}

export function KeyboardPanel({ source }: { source: KeyboardSource }) {
  const commands = useWindowCommands();
  const platform: KeyPlatform = commands?.platform ?? "other";
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
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
  const anyChanged = rows.some((row) => row.changed);

  function capture(
    event: KeyboardEvent<HTMLElement>,
    id: string,
    current: StoredKeybindings,
  ) {
    // 이 칸의 키는 page의 기본 동작(Tab 이동, 글자 입력)으로도 가지 않는다.
    event.preventDefault();
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.repeat) return;
    const plain =
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Escape") {
      setEditing(null);
      setProblem(null);
      return;
    }
    if (plain && (event.key === "Backspace" || event.key === "Delete")) {
      setEditing(null);
      setProblem(null);
      void save(current, withChords(current, platform, id, []));
      return;
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
    const check = checkChord(text, id, platform, current[platform] ?? {});
    if (!check.ok) {
      setProblem({ id, text: problemText(check, text, platform) });
      return;
    }
    setEditing(null);
    setProblem(null);
    void save(current, withChords(current, platform, id, [text]));
  }

  return (
    <div data-keyboard-settings="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-keyboard")}</h1>
      <p className={styles.lead}>{t("settings.intro.keyboard")}</p>
      <Loading loading={stored === null} placeholder={<Skeleton lines={6} />}>
        {stored === null ? null : (
          <>
            <ul className={styles.lines}>
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={styles.line}
                  data-key-row={row.id}
                  data-key-changed={row.changed ? "" : undefined}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.lineName}>{row.name}</span>
                    {editing === row.id ? (
                      <span className={styles.lineHelp}>
                        {t("settings.note.key-capture")}
                      </span>
                    ) : null}
                    {problem?.id === row.id ? (
                      <p className={styles.rejected} role="alert">
                        {problem.text}
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.lineControl}>
                    <div className={styles.keyControl}>
                      {editing === row.id ? (
                        <div
                          className={styles.keyCapture}
                          tabIndex={0}
                          role="textbox"
                          aria-label={t("settings.label.key-capture", {
                            name: row.name,
                          })}
                          {...{ [KEY_CAPTURE_ATTRIBUTE]: "" }}
                          ref={(element) => element?.focus()}
                          onKeyDown={(event) => capture(event, row.id, stored)}
                          onBlur={() => {
                            setEditing(null);
                            setProblem(null);
                          }}
                        >
                          {t("settings.label.key-capture", { name: row.name })}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.keyButton}
                          aria-label={t("settings.button.key-change", {
                            name: row.name,
                          })}
                          data-key-change={row.id}
                          onClick={() => {
                            setProblem(null);
                            setEditing(row.id);
                          }}
                        >
                          {row.chords.length === 0 ? (
                            <span className={styles.lineHelp}>
                              {t("settings.label.key-none")}
                            </span>
                          ) : (
                            row.chords.map((chord) => (
                              <Kbd
                                key={chord}
                                keys={[chordLabel(chord, platform)]}
                              />
                            ))
                          )}
                        </button>
                      )}
                      {row.changed ? (
                        <Button
                          size="sm"
                          data-key-reset={row.id}
                          aria-label={t("settings.button.key-reset", {
                            name: row.name,
                          })}
                          onClick={() =>
                            void save(
                              stored,
                              withChords(stored, platform, row.id, null),
                            )
                          }
                        >
                          {t("settings.button.reset-default")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
