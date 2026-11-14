// Settings › Browser의 Devices 구역. preview 탭이 흉내 낼 기기(이름, 크기, DPR, OS)를 더하고 고치고 지운다.
// 목록은 설정 `shell.devices` 하나라 바꿀 때마다 목록 전체를 저장한다. 범위와 이름 겹침은 core의 선언이 거절한다.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import { settingsList } from "../../../../../protocol/config/file.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import styles from "../settings.module.css";
import { DEVICES_KEY } from "./model.ts";
import type { BrowserSettingsSource, Device, DeviceOs } from "./source.ts";
import { devicesOf } from "./window-source.ts";

interface Form {
  name: string;
  width: string;
  height: string;
  dpr: string;
  os: DeviceOs;
}

const NEW_DEVICE: Form = {
  name: "",
  width: "390",
  height: "844",
  dpr: "3",
  os: "ios",
};

const formOf = (device: Device): Form => ({
  name: device.name,
  width: String(device.width),
  height: String(device.height),
  dpr: String(device.dpr),
  os: device.os,
});

const deviceOf = (form: Form): Device => ({
  name: form.name.trim(),
  width: Number(form.width),
  height: Number(form.height),
  dpr: Number(form.dpr),
  os: form.os,
});

const osLabel = (os: DeviceOs) =>
  os === "ios"
    ? t("settings.label.device-ios")
    : t("settings.label.device-android");

export function DeviceRows({ source }: { source: BrowserSettingsSource }) {
  const { loaded } = useCoreRead(settingsList, { keys: [DEVICES_KEY] });
  const read = useMemo(
    () =>
      loaded.state === "ready" ? devicesOf(effectiveOf(loaded.value)) : null,
    [loaded],
  );
  // 저장한 목록은 다음에 읽은 값이 올 때까지 그대로 보인다.
  const [saved, setSaved] = useState<readonly Device[] | null>(null);
  useEffect(() => setSaved(null), [read]);
  // 고치는 줄의 index. 새로 더하는 줄은 목록 길이다.
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(NEW_DEVICE);
  const [error, setError] = useState(false);

  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-devices="failed">
        {t("settings.error.devices-load-failed")}
      </p>
    );
  }
  const list = saved ?? read!;

  function open(index: number, next: Form): void {
    setForm(next);
    setError(false);
    setEditing(index);
  }

  async function save(next: readonly Device[]): Promise<boolean> {
    const done = await source.saveDevices(next);
    if (done.ok) setSaved(next);
    return done.ok;
  }

  async function submit(): Promise<void> {
    const device = deviceOf(form);
    const next =
      editing === list.length
        ? [...list, device]
        : list.map((d, i) => (i === editing ? { ...d, ...device } : d));
    if (await save(next)) setEditing(null);
    else setError(true);
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const editor = (
    <li className={styles.line} data-device-form="">
      <div className={styles.lineMain}>
        <Field label={t("settings.label.device-name")}>
          <Input
            value={form.name}
            autoFocus
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field label={t("settings.label.device-width")}>
          <Input
            value={form.width}
            inputMode="numeric"
            onChange={(event) => set({ width: event.target.value })}
          />
        </Field>
        <Field label={t("settings.label.device-height")}>
          <Input
            value={form.height}
            inputMode="numeric"
            onChange={(event) => set({ height: event.target.value })}
          />
        </Field>
        <Field label={t("settings.label.device-dpr")}>
          <Input
            value={form.dpr}
            inputMode="decimal"
            onChange={(event) => set({ dpr: event.target.value })}
          />
        </Field>
        <Field label={t("settings.label.device-os")}>
          <Select
            options={(["ios", "android"] as const).map((os) => ({
              value: os,
              label: osLabel(os),
            }))}
            value={form.os}
            onValueChange={(os) => set({ os: os as DeviceOs })}
          />
        </Field>
        {error ? (
          <p className={styles.rejected} role="alert" data-device-error="">
            {t("settings.error.device-invalid")}
          </p>
        ) : null}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button onClick={() => setEditing(null)}>
            {t("settings.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            data-device-save=""
            onClick={() => void submit()}
          >
            {t("settings.button.device-save")}
          </Button>
        </div>
      </div>
    </li>
  );

  return (
    <>
      {list.length === 0 && editing === null ? (
        <p className={styles.notice} data-devices="empty">
          {t("settings.notice.devices-empty")}
        </p>
      ) : (
        <ul className={styles.lines} data-devices="ok">
          {list.map((device, index) =>
            editing === index ? (
              <Fragment key={device.name}>{editor}</Fragment>
            ) : (
              <li
                key={device.name}
                className={styles.line}
                data-device={device.name}
              >
                <div className={styles.lineMain}>
                  <span className={styles.productName}>{device.name}</span>
                  <span className={`${styles.lineHelp} ${styles.mono}`}>
                    {`${device.width}×${device.height} @${device.dpr}x · ${osLabel(device.os)}`}
                  </span>
                </div>
                <div className={styles.lineControl}>
                  <div className={styles.actions}>
                    <Button
                      icon={actionIcons.edit}
                      data-device-edit=""
                      onClick={() => open(index, formOf(device))}
                    >
                      {t("settings.button.device-edit")}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={actionIcons.delete}
                      data-device-remove=""
                      onClick={() =>
                        void save(list.filter((_, i) => i !== index))
                      }
                    >
                      {t("settings.button.device-remove")}
                    </Button>
                  </div>
                </div>
              </li>
            ),
          )}
          {editing === list.length ? editor : null}
        </ul>
      )}
      {editing === null ? (
        <div className={styles.actions}>
          <Button
            icon={actionIcons.add}
            data-device-add=""
            onClick={() => open(list.length, NEW_DEVICE)}
          >
            {t("settings.button.device-add")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
