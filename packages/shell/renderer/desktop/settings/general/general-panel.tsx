// Settings › General. 요소가 선언한 설정 항목을 타입(불리언, 숫자 범위, 선택지, 목록)대로 보고 바꾼다.
// 사람이 정한 값만 저장하고 기본값과 나눠 보인다. 틀린 값은 거절 이유를 줄 아래에 보이고 저장된 값은
// 그대로다. 필수 설정이 비어 있으면 panel 위쪽 toast가 알린다.

import { t } from "@lophn/i18n";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Field, Input, Select, Switch } from "@lophn/ui/input";
import { Toast } from "@lophn/ui/overlay";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { type KeyboardEvent, useState } from "react";
import { settingsList } from "../../../../../protocol/config/file.ts";
import { actionIcons, connectionFailedIcon } from "../../../icons/mod.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { entriesOf as settingEntriesOf } from "../declared.ts";
import type { SettingsPane } from "../model.ts";
import styles from "../settings.module.css";
import type { SettingChange, SettingEntry, SettingsSource } from "../source.ts";
import {
  type Control,
  choiceLabel,
  controlOf,
  currentValue,
  defaultText,
  groupEntries,
  groupTitle,
  helpOf,
  isRequiredEmpty,
  nameOf,
  numberOf,
  rangeText,
  rejectionText,
} from "./model.ts";
import { NamedControl } from "./named-control.tsx";

interface GeneralPanelProps {
  source: SettingsSource;
  /** 필수 설정 안내의 [Choose in Agents]가 쓴다. */
  onPane: (pane: SettingsPane) => void;
}

// 안내가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

type Save = (change: SettingChange) => Promise<string | null>;

export function GeneralPanel({ source, onPane }: GeneralPanelProps) {
  const { loaded, reload } = useCoreRead(settingsList, {});
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  // 저장하면 거절 이유 글을, 저장됐으면 null을 돌려준다. 저장된 값은 core가 낸 변경으로 다시 읽어 보인다.
  const save: Save = async (change) => {
    const result = await source.update([change]);
    if (!result.ok) return t("settings.error.value-not-saved");
    const rejection = result.value.rejected[0];
    if (rejection !== undefined) return rejectionText(rejection.reason);
    return null;
  };

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.general-target")}
        onRetry={reload}
      />
    );
  }
  const entries =
    loaded.state === "ready" ? settingEntriesOf(loaded.value) : [];
  const groups = groupEntries(entries);
  const missing = entries.find(
    (entry) => isRequiredEmpty(entry) && !closed.has(entry.key),
  );
  return (
    <div data-general="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-general")}</h1>
      <p className={styles.lead}>{t("settings.intro.general")}</p>
      {missing === undefined ? null : (
        <div className={styles.toastSlot} data-required-empty={missing.key}>
          <Toast
            title={t("settings.title.not-set", { name: nameOf(missing.key) })}
            body={t("settings.note.not-set")}
            actions={[
              {
                id: "choose",
                label: t("settings.button.choose-in-agents"),
              },
            ]}
            onAction={() => {
              setClosed(new Set([...closed, missing.key]));
              onPane("agents");
            }}
            onClose={() => setClosed(new Set([...closed, missing.key]))}
            timer={NO_TIMER}
          />
        </div>
      )}
      <Loading
        loading={loaded.state === "loading"}
        placeholder={<Skeleton lines={5} />}
      >
        {groups.length === 0 ? (
          <p className={styles.notReady}>{t("settings.empty.general")}</p>
        ) : (
          groups.map((group) => (
            <section key={group.owner} className={styles.groupBlock}>
              <h2 className={styles.groupTitle}>{groupTitle(group.owner)}</h2>
              <ul className={styles.lines}>
                {group.entries.map((entry) => (
                  <SettingItem key={entry.key} entry={entry} save={save} />
                ))}
              </ul>
            </section>
          ))
        )}
      </Loading>
    </div>
  );
}

function SettingItem({ entry, save }: { entry: SettingEntry; save: Save }) {
  const control = controlOf(entry.type);
  const [rejected, setRejected] = useState<string | null>(null);
  const help = helpOf(entry.key);
  const name = nameOf(entry.key);

  async function change(value: unknown): Promise<void> {
    setRejected(await save({ key: entry.key, action: "set", value }));
  }
  async function reset(): Promise<void> {
    setRejected(await save({ key: entry.key, action: "unset" }));
  }

  const main = (label: React.ReactNode) => (
    <div className={styles.lineMain}>
      {label}
      {help === null ? null : <span className={styles.lineHelp}>{help}</span>}
      {control.kind === "range" && rangeText(control) !== null ? (
        <span className={styles.lineHelp}>{rangeText(control)}</span>
      ) : null}
      {control.kind === "list" ? (
        <Tokens entry={entry} change={change} />
      ) : null}
      {rejected === null ? null : (
        <span className={styles.rejected} role="alert" data-rejected="">
          <Icon icon={connectionFailedIcon} pixels={iconPixels("base")} />
          {rejected}
        </span>
      )}
      <span className={styles.caption}>
        <span className={styles.mono}>{entry.key}</span>
        {" · "}
        {entry.hasChosen
          ? t("settings.label.chosen-default", {
              value: defaultText(entry),
            })
          : isRequiredEmpty(entry)
            ? t("settings.label.value-not-set")
            : t("settings.label.default")}
      </span>
    </div>
  );

  return (
    <li
      className={styles.line}
      data-setting={entry.key}
      data-changed={entry.hasChosen}
    >
      {control.kind === "list" || control.kind === "fixed" ? (
        <>
          {main(<span className={styles.lineName}>{name}</span>)}
          <div className={styles.lineControl}>
            {control.kind === "list" ? (
              <AddEntry entry={entry} change={change} />
            ) : (
              <span data-value="">{fixedText(entry)}</span>
            )}
            <ResetButton entry={entry} reset={reset} />
          </div>
        </>
      ) : (
        <NamedControl
          name={name}
          invalid={rejected !== null}
          labelClass={styles.lineName}
        >
          {({ label, provide }) => (
            <>
              {main(label)}
              <div className={styles.lineControl}>
                {provide(
                  <Control
                    entry={entry}
                    control={control}
                    change={change}
                    rejected={rejected !== null}
                  />,
                )}
                <ResetButton entry={entry} reset={reset} />
              </div>
            </>
          )}
        </NamedControl>
      )}
    </li>
  );
}

function fixedText(entry: SettingEntry): string {
  return isRequiredEmpty(entry)
    ? t("settings.label.value-not-set")
    : defaultText({
        ...entry,
        hasDefault: true,
        defaultValue: currentValue(entry),
      });
}

function ResetButton({
  entry,
  reset,
}: {
  entry: SettingEntry;
  reset: () => Promise<void>;
}) {
  if (!entry.hasChosen) return null;
  return (
    <div className={styles.endSlot}>
      <Button
        size="sm"
        variant="ghost"
        icon={actionIcons.reset}
        onClick={() => void reset()}
      >
        {t("settings.button.reset-default")}
      </Button>
    </div>
  );
}

function Control({
  entry,
  control,
  change,
  rejected,
}: {
  entry: SettingEntry;
  control: Exclude<Control, { kind: "list" | "fixed" }>;
  change: (value: unknown) => Promise<void>;
  rejected: boolean;
}) {
  const value = currentValue(entry);
  switch (control.kind) {
    case "boolean":
      return (
        <div className={styles.endSlot}>
          <Switch
            label={
              value === true
                ? t("settings.label.value-on")
                : t("settings.label.value-off")
            }
            checked={value === true}
            onCheckedChange={(next) => void change(next)}
          />
        </div>
      );
    case "range":
      return (
        <RangeInput
          // 저장된 값이 바뀌면 입력 글도 그 값으로 다시 시작한다.
          key={String(value)}
          start={typeof value === "number" ? String(value) : ""}
          control={control}
          rejected={rejected}
          change={change}
        />
      );
    case "text":
      return (
        <TextInput
          key={String(value)}
          start={typeof value === "string" ? value : ""}
          rejected={rejected}
          change={change}
        />
      );
    case "choice":
      return (
        <Select
          key={String(value)}
          options={control.options.map((option) => ({
            value: option,
            label: choiceLabel(option, entry.key),
          }))}
          defaultValue={typeof value === "string" ? value : undefined}
          onValueChange={(next) => void change(next)}
        />
      );
  }
}

function TextInput({
  start,
  rejected,
  change,
}: {
  start: string;
  rejected: boolean;
  change: (value: unknown) => Promise<void>;
}) {
  const [text, setText] = useState(start);
  function commit(): void {
    if (text !== start || rejected) void change(text.trim());
  }
  return (
    <Input
      value={text}
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function RangeInput({
  start,
  control,
  rejected,
  change,
}: {
  start: string;
  control: Extract<Control, { kind: "range" }>;
  rejected: boolean;
  change: (value: unknown) => Promise<void>;
}) {
  const [text, setText] = useState(start);
  function commit(): void {
    const value = numberOf(text);
    // 비었거나 숫자가 아니면 보내지 않고 저장된 값으로 돌아간다.
    if (value === null) setText(start);
    else if (text !== start || rejected) void change(value);
  }
  return (
    <Input
      type="number"
      min={control.min ?? undefined}
      max={control.max ?? undefined}
      step={control.integer ? 1 : "any"}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function entriesOf(entry: SettingEntry): readonly string[] {
  const value = currentValue(entry);
  return Array.isArray(value) ? (value as string[]) : [];
}

function Tokens({
  entry,
  change,
}: {
  entry: SettingEntry;
  change: (value: unknown) => Promise<void>;
}) {
  const items = entriesOf(entry);
  if (items.length === 0) return null;
  return (
    <ul className={styles.tokens}>
      {items.map((item) => (
        <li key={item} className={styles.token}>
          {item}
          <IconButton
            icon={actionIcons.remove}
            label={t("settings.button.remove-entry", { item })}
            size="sm"
            onClick={() => void change(items.filter((one) => one !== item))}
          />
        </li>
      ))}
    </ul>
  );
}

function AddEntry({
  entry,
  change,
}: {
  entry: SettingEntry;
  change: (value: unknown) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const items = entriesOf(entry);
  function add(): void {
    const item = text.trim();
    if (item === "" || items.includes(item)) return;
    setText("");
    void change([...items, item]);
  }
  return (
    <>
      <Field label={t("settings.label.add-entry")}>
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") add();
          }}
        />
      </Field>
      <div className={styles.endSlot}>
        <Button size="sm" icon={actionIcons.add} onClick={add}>
          {t("settings.button.add-entry")}
        </Button>
      </div>
    </>
  );
}
