// Settings › Keyboard. 작업대 단축키를 command마다 한 줄로 보이고 바꾼다. 줄은 이름 아래 작은 설명이 있고, 위의
// 검색 칸이 이름·설명·키로 줄을 거른다. 키 칸을 누르면 그 줄이 새 키를 받고, 받은 키는 바로 저장해 창의
// keybinding service와 main에 덮는다. 번호 줄(n번째 탭, split의 n번째 쪽)은 modifier 하나를 받아 모든 번호에 붙인다.
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, IconButton, Kbd } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { SearchFilter } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import {
  APP_PANEL,
  checkChord,
  chordLabel,
  chordOfInput,
  findConflicts,
  type KeyPlatform,
  modifierLabel,
  bindingId,
} from "../../../../ipc/keybindings.ts";
import { KEY_CAPTURE_ATTRIBUTE } from "../../../commands/window.ts";
import { SEQUENCE_WAIT_MS } from "../../../commands/keybinding-service.ts";
import {
  useContributedCommands,
  useWindowCommands,
} from "../../../commands/react.tsx";
import { actionIcons, settingsIcons } from "../../../icons/mod.ts";
import { panelChoices } from "../../../workspace/app-panel-tab.tsx";
import { useAppPanelApps } from "../../../workspace/project-settings/quick-launch-editor.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import {
  appRows,
  conflictClearKeys,
  contributedBindings,
  contributedDefaults,
  contributedRows,
  filterRows,
  type KeyRow,
  keyRows,
  modifierOfInput,
  nameOfIds,
  numberedKeys,
  rowConflicts,
  rowKey,
  rowsWithChord,
  SECTIONS,
  takeKeys,
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
  reason: "unsupported" | "needs_modifier" | "reserved",
  platform: KeyPlatform,
): string {
  switch (reason) {
    case "unsupported":
      return t("settings.error.key-unsupported");
    case "needs_modifier":
      return t("settings.error.key-needs-modifier", {
        modifiers: MODIFIERS[platform],
      });
    case "reserved":
      return t("settings.error.key-reserved");
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
  // 키로 찾기. 켜면 검색 칸이 누른 키를 받고 그 키를 쓰는 줄만 보인다.
  const [byKey, setByKey] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [conflictsToggle, setConflictsToggle] = useState(false);
  // 새 키가 다른 줄에서 쓰는 중이라 "바꾸기"를 기다린다. keys는 바꾸기가 한 번에 저장할 id → chord다.
  const [taking, setTaking] = useState<{
    id: string;
    key: string;
    name: string;
    keys: Record<string, readonly string[]>;
  } | null>(null);
  // 두 타 key를 받는 중이면 첫 타. 화면에 보이고, SEQUENCE_WAIT_MS 안에 둘째 타가 오면 이어 붙인다.
  const firstStroke = useRef<string | null>(null);
  const [pendingStroke, setPendingStroke] = useState<string | null>(null);
  const waitTimer = useRef<(() => void) | null>(null);
  useEffect(() => () => waitTimer.current?.(), []);
  const { apps, loading: appsLoading, failed: appsFailed } = useAppPanelApps();
  const [notSaved, setNotSaved] = useState(false);
  const contributions = useContributedCommands();

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
  const extra = contributedBindings(contributions, platform, overrides);
  const defaults = contributedDefaults(contributions, platform);
  const rows = [
    ...keyRows(platform, overrides),
    ...contributedRows(contributions, platform, overrides),
    ...(appsLoading
      ? []
      : appRows(appsFailed ? null : panelChoices(apps), overrides)),
  ];
  const names = nameOfIds(rows);
  const conflictList = findConflicts(platform, overrides, extra);
  const conflicts = rowConflicts(rows, conflictList);
  // 겹침이 다 풀리면 토글은 꺼진 것으로 본다.
  const conflictsOnly = conflictsToggle && conflictList.length > 0;
  const matched = byKey
    ? pressed === null
      ? rows
      : rowsWithChord(rows, pressed)
    : filterRows(rows, query, (row) => rowKeyText(row, platform));
  const shown = conflictsOnly
    ? matched.filter((row) => conflicts.has(rowKey(row)))
    : matched;
  const filtering =
    conflictsOnly || (byKey ? pressed !== null : query.trim() !== "");
  const anyChanged = rows.some((row) => row.changed);

  function clearWait() {
    waitTimer.current?.();
    waitTimer.current = null;
  }

  function leave() {
    clearWait();
    firstStroke.current = null;
    setPendingStroke(null);
    setEditing(null);
    setProblem(null);
  }

  function stop() {
    leave();
    setTaking(null);
  }

  function record(event: KeyboardEvent<HTMLElement>) {
    // Tab만 누르면 칸을 떠난다. 나머지 키는 page로도 command로도 가지 않고 이 칸이 받는다.
    const plain =
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.repeat) return;
    if (plain && (event.key === "Backspace" || event.key === "Escape")) {
      setPressed(null);
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
    if (text !== null) setPressed(text);
  }

  /** 받은 chord 하나를 줄에 단다. 검사를 지나면 저장하고, 다른 줄이 쓰면 "바꾸기"를 묻는다. */
  function applyChord(row: KeyRow, chord: string, current: StoredKeybindings) {
    const id = rowKey(row);
    const ids = row.kind === "single" ? [row.id] : row.ids;
    // 번호 줄은 modifier만 눌러도 숫자 키 하나로 본다. 모든 번호의 키를 하나씩 검사한다.
    const keys =
      row.kind === "single"
        ? { [row.id]: [chord] }
        : numberedKeys(row.ids, row.numbers, modifierOfInput(chord));
    let taken: { key: string; name: string } | null = null;
    for (const chords of Object.values(keys)) {
      const one = chords[0];
      if (one === undefined) {
        setProblem({
          id,
          text: t("settings.error.key-numbered-needs-modifier", {
            modifiers: MODIFIERS[platform],
          }),
        });
        return;
      }
      const check = checkChord(
        one,
        ids,
        platform,
        current[platform] ?? {},
        row.kind === "single" ? row.context : undefined,
        extra,
      );
      if (check.ok) continue;
      if (check.reason !== "taken") {
        setProblem({ id, text: problemText(check.reason, platform) });
        return;
      }
      taken ??= {
        key: chordLabel(one, platform),
        name: names.get(bindingId(check.by)) ?? "",
      };
    }
    if (taken !== null) {
      leave();
      setTaking({ id, ...taken, keys });
      return;
    }
    stop();
    void save(current, withKeys(current, platform, keys, defaults));
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
    const plain =
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === "Escape") return stop();
    if (plain && (event.key === "Backspace" || event.key === "Delete")) {
      stop();
      const cleared =
        row.kind === "single"
          ? { [row.id]: [] }
          : numberedKeys(row.ids, row.numbers, null);
      return void save(current, withKeys(current, platform, cleared, defaults));
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
    // 번호 줄은 modifier 하나만 받는다(두 타를 기다리지 않는다).
    if (row.kind !== "single") return applyChord(row, text, current);
    // 한 타 뒤 잠깐 둘째 타를 기다린다. 오지 않으면 그 한 타다. 오면 두 타를 공백으로 잇는다.
    const first = firstStroke.current;
    if (first === null) {
      firstStroke.current = text;
      setPendingStroke(text);
      clearWait();
      const handle = setTimeout(() => {
        waitTimer.current = null;
        if (firstStroke.current !== text) return;
        firstStroke.current = null;
        setPendingStroke(null);
        applyChord(row, text, current);
      }, SEQUENCE_WAIT_MS);
      waitTimer.current = () => clearTimeout(handle);
      return;
    }
    clearWait();
    firstStroke.current = null;
    setPendingStroke(null);
    applyChord(row, `${first} ${text}`, current);
  }

  function keyLine(row: KeyRow, stored: StoredKeybindings) {
    const id = rowKey(row);
    // 앱 panel과 지금 기여가 없는 동적 id는 지우기만 된다.
    const removable =
      row.kind === "single" && (row.command === APP_PANEL || row.missing);
    const conflict = conflicts.get(id);
    const hasKeys = row.kind === "numbered" || row.chords.length > 0;
    const clearKeys =
      row.kind === "single"
        ? { [row.id]: [] }
        : conflictClearKeys(row.ids, conflictList);
    const resetKeys =
      row.kind === "single"
        ? { [row.id]: null }
        : Object.fromEntries(row.ids.map((one) => [one, null]));
    const missing = row.kind === "single" && row.missing;
    return (
      <li
        key={id}
        className={styles.line}
        data-key-row={id}
        data-key-changed={row.changed ? "" : undefined}
        data-key-conflict={conflict === undefined ? undefined : ""}
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
              : missing
                ? t(
                    row.command === APP_PANEL
                      ? "settings.note.key-missing-app"
                      : "settings.note.key-missing-command",
                  )
                : row.help}
          </span>
          {conflict === undefined ? null : (
            <span className={styles.lineHelp} data-key-conflict-note="">
              {[
                ...(conflict.reserved
                  ? [t("settings.note.key-conflict-reserved")]
                  : []),
                ...(conflict.names.length > 0
                  ? [
                      t("settings.note.key-conflict-with", {
                        names: conflict.names.join(", "),
                      }),
                    ]
                  : []),
              ].join(" ")}
            </span>
          )}
          {problem?.id === id ? (
            <p className={styles.rejected} role="alert">
              {problem.text}
            </p>
          ) : null}
          {taking?.id === id ? (
            <p className={styles.notice} role="status" data-key-taken="">
              {t("settings.note.key-taken", {
                key: taking.key,
                name: taking.name,
              })}{" "}
              <Button
                size="sm"
                data-key-take={id}
                onClick={() => {
                  const keys = taking.keys;
                  setTaking(null);
                  void save(
                    stored,
                    withKeys(
                      stored,
                      platform,
                      takeKeys(platform, stored[platform] ?? {}, keys, extra),
                      defaults,
                    ),
                  );
                }}
              >
                {t("settings.button.key-take")}
              </Button>{" "}
              <Button
                size="sm"
                variant="ghost"
                data-key-take-cancel={id}
                onClick={() => setTaking(null)}
              >
                {t("settings.button.cancel")}
              </Button>
            </p>
          ) : null}
        </div>
        <div className={styles.lineControl}>
          <div className={styles.keyControl}>
            {missing ? (
              <KeyView row={row} platform={platform} />
            ) : editing === id ? (
              <div
                className={styles.keyCapture}
                tabIndex={0}
                role="textbox"
                aria-label={t("settings.label.key-capture", { name: row.name })}
                {...{ [KEY_CAPTURE_ATTRIBUTE]: "" }}
                ref={(element) => element?.focus()}
                onKeyDown={(event) => capture(event, row, stored)}
                onBlur={leave}
              >
                {pendingStroke === null ? (
                  t("settings.label.key-capture", { name: row.name })
                ) : (
                  <Kbd keys={[chordLabel(pendingStroke, platform)]} />
                )}
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
                  setTaking(null);
                  setEditing(id);
                }}
              >
                <KeyView row={row} platform={platform} />
              </button>
            )}
            {row.changed && !removable ? (
              <Button
                size="sm"
                icon={actionIcons.reset}
                data-key-reset={id}
                aria-label={t("settings.button.key-reset", { name: row.name })}
                onClick={() =>
                  void save(
                    stored,
                    withKeys(stored, platform, resetKeys, defaults),
                  )
                }
              >
                {t("settings.button.reset-default")}
              </Button>
            ) : null}
            {(removable || conflict !== undefined) && hasKeys ? (
              <Button
                size="sm"
                variant="ghost"
                data-key-clear={id}
                aria-label={t("settings.button.key-clear", { name: row.name })}
                onClick={() =>
                  void save(
                    stored,
                    withKeys(stored, platform, clearKeys, defaults),
                  )
                }
              >
                {t("settings.button.key-clear-visible")}
              </Button>
            ) : null}
          </div>
        </div>
      </li>
    );
  }

  return (
    <div data-keyboard-settings="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-keyboard")}</h1>
      <p className={styles.lead}>{t("settings.intro.keyboard")}</p>
      <Loading loading={stored === null} placeholder={<Skeleton lines={6} />}>
        {stored === null ? null : (
          <>
            {conflictList.length === 0 ? null : (
              <div className={styles.toolbar}>
                <p
                  className={styles.notice}
                  role="status"
                  data-key-conflicts=""
                >
                  {t("settings.label.key-conflicts", {
                    n: conflictList.length,
                  })}
                </p>
                <Button
                  size="sm"
                  variant={conflictsOnly ? "primary" : "secondary"}
                  aria-pressed={conflictsOnly}
                  data-key-conflicts-only=""
                  onClick={() => setConflictsToggle((on) => !on)}
                >
                  {t("settings.button.key-conflicts-only")}
                </Button>
              </div>
            )}
            <div className={`${styles.searchRow} ${styles.keySearchRow}`}>
              {byKey ? (
                <div className={styles.keySearch}>
                  <span className={styles.keySearchLabel}>
                    {t("settings.label.key-search-by-key")}
                  </span>
                  <div
                    className={styles.keyRecord}
                    tabIndex={0}
                    role="searchbox"
                    aria-label={t("settings.label.key-search-by-key")}
                    data-key-record=""
                    {...{ [KEY_CAPTURE_ATTRIBUTE]: "" }}
                    ref={(element) => {
                      if (element !== null && pressed === null) element.focus();
                    }}
                    onKeyDown={record}
                  >
                    {pressed === null ? (
                      <span className={styles.lineHelp}>
                        {t("settings.note.key-search-by-key")}
                      </span>
                    ) : (
                      <Kbd keys={[chordLabel(pressed, platform)]} />
                    )}
                  </div>
                </div>
              ) : (
                <SearchFilter
                  value={query}
                  onChange={setQuery}
                  label={t("settings.label.key-search")}
                />
              )}
              <IconButton
                icon={settingsIcons.keyboard}
                label={t("settings.button.key-search-by-key")}
                aria-pressed={byKey}
                variant={byKey ? "secondary" : "ghost"}
                data-key-search-toggle=""
                onClick={() => {
                  setByKey((on) => !on);
                  setPressed(null);
                }}
              />
            </div>
            {shown.length === 0 && filtering ? (
              <p className={styles.lineHelp} data-key-search="empty">
                {t("settings.empty.key-search")}
              </p>
            ) : (
              SECTIONS.map(({ section, title }, at) => {
                const inSection = shown.filter(
                  (row) => row.section === section,
                );
                // app section은 앱을 읽는 동안과 앱이 없을 때도 자리를 둔다. 거르는 중이면 다른 section처럼 줄이 없으면 숨는다.
                const placeholder = section === "app" && !filtering;
                if (inSection.length === 0 && !placeholder) return null;
                return (
                  <section
                    key={section}
                    className={at === 0 ? undefined : styles.groupBlock}
                    data-key-section={section}
                  >
                    <h2 className={styles.groupTitle}>{t(title)}</h2>
                    {inSection.length > 0 ? (
                      <ul className={styles.lines}>
                        {inSection.map((row) => keyLine(row, stored))}
                      </ul>
                    ) : appsLoading ? (
                      <Skeleton lines={2} />
                    ) : (
                      <p className={styles.lineHelp}>
                        {t("settings.empty.key-apps")}
                      </p>
                    )}
                  </section>
                );
              })
            )}
            {anyChanged ? (
              <div className={`${styles.endSlot} ${styles.groupBlock}`}>
                <Button
                  icon={actionIcons.reset}
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
