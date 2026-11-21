// Settings › Browser의 Profiles 구역. 맨 위가 기본 profile(지우지 못한다)이고 아래가 사람이 만든 profile이다.
// 목록은 설정 `shell.browser_profiles` 하나라 바꿀 때마다 목록 전체를 저장한다. 저장이 끝나야 줄이 바뀌고 열리므로
// 막 만든 profile은 core가 받은 뒤에야 보인다. 지우기는 그 profile의 login, partition data, 목록 순서로 하고 중간에 실패하면
// 멈춘다(profile이 남아 있어 다시 할 수 있다).
import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { Field, Input, SwatchPicker } from "@lophn/ui/input";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import { settingsList } from "../../../../../protocol/config/file.ts";
import { agentList } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { AGENT_CHARACTER_COLORS } from "../../../../../protocol/lophn-agent/agent-profile.ts";
import {
  BROWSER_PROFILE_ID_PREFIX,
  BROWSER_PROFILES_MAX,
  BROWSER_PROFILES_SETTING,
} from "../../../../../protocol/shell/browser-profiles.ts";
import { ProfileMark } from "../../../browser/browser-chrome.tsx";
import { CHARACTER_COLORS } from "../../../parts/avatar/character.tsx";
import { newId } from "../../../prefixed-id.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import styles from "../settings.module.css";
import { useLoginRows } from "./login-rows.tsx";
import { PROFILE_COLOR_LABEL } from "./model.ts";
import type { BrowserProfile, BrowserSettingsSource } from "./source.ts";
import { profilesOf } from "./window-source.ts";

// 어느 칸을 여는가. 새 profile은 둘 다, 있는 profile은 Rename이 이름만 Color가 색만 고른다.
type Fields = "name" | "color" | "both";
interface Editing {
  /** 고치는 profile의 id. 새 profile은 null이다. */
  readonly id: string | null;
  readonly fields: Fields;
}

export function ProfileRows({
  source,
  onClear,
}: {
  source: BrowserSettingsSource;
  /** [Clear data]를 눌렀다. 확인과 결과는 호출한 쪽이 보인다. */
  onClear: (profile: BrowserProfile) => void;
}) {
  const { loaded } = useCoreRead(settingsList, {
    keys: [BROWSER_PROFILES_SETTING],
  });
  const read = useMemo(
    () =>
      loaded.state === "ready" ? profilesOf(effectiveOf(loaded.value)) : null,
    [loaded],
  );
  // 저장한 목록은 다음에 읽은 값이 올 때까지 그대로 보인다.
  const [saved, setSaved] = useState<readonly BrowserProfile[] | null>(null);
  useEffect(() => setSaved(null), [read]);
  const agents = useCoreRead(agentList, {}).loaded;
  const logins = useLoginRows();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<Pick<BrowserProfile, "name" | "color">>({
    name: "",
    color: AGENT_CHARACTER_COLORS[0],
  });
  const [error, setError] = useState<"invalid" | "failed" | null>(null);
  const [deleting, setDeleting] = useState<BrowserProfile | null>(null);
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);

  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-profiles="failed">
        {t("settings.error.profiles-load-failed")}
      </p>
    );
  }
  const list = saved ?? read!;
  const loginsOf = (profile: BrowserProfile) =>
    logins.state === "ready"
      ? logins.value.filter((login) => login.profile === profile.id)
      : null;
  const agentNames = (profile: BrowserProfile): string | null =>
    agents.state === "ready"
      ? agents.value.agents
          .filter((agent) => agent.browser_profile === profile.id)
          .map((agent) => agent.name)
          .join(", ")
      : null;

  function open(next: Editing, profile: BrowserProfile | null): void {
    // 새 profile의 색은 아직 안 쓴 색부터 준다.
    setForm({
      name: profile?.name ?? "",
      color:
        profile?.color ??
        AGENT_CHARACTER_COLORS.find(
          (color) => !list.some((one) => one.color === color),
        ) ??
        AGENT_CHARACTER_COLORS[0],
    });
    setError(null);
    setEditing(next);
  }

  async function save(next: readonly BrowserProfile[]): Promise<boolean> {
    const done = await source.saveProfiles(next);
    if (done.ok) setSaved(next);
    else {
      setError(
        done.code === "invalid_value" || done.code === "out_of_range"
          ? "invalid"
          : "failed",
      );
    }
    return done.ok;
  }

  async function submit(): Promise<void> {
    const name = form.name.trim();
    if (editing!.fields !== "color" && (name === "" || name.length > 40)) {
      return setError("invalid");
    }
    const next =
      editing!.id === null
        ? [
            ...list,
            {
              id: newId(BROWSER_PROFILE_ID_PREFIX),
              name,
              color: form.color,
            },
          ]
        : list.map((one) =>
            one.id === editing!.id
              ? {
                  ...one,
                  ...(editing!.fields === "color" ? {} : { name }),
                  ...(editing!.fields === "name" ? {} : { color: form.color }),
                }
              : one,
          );
    if (await save(next)) setEditing(null);
  }

  // ① 그 profile의 login ② partition data ③ 목록에서 뺀다. 앞이 실패하면 멈춘다.
  async function remove(profile: BrowserProfile): Promise<void> {
    setDeleting(null);
    setDeleteFailed(null);
    const failed = () => setDeleteFailed(profile.name);
    for (const login of loginsOf(profile) ?? []) {
      if (!(await source.deleteLogin(login.id)).ok) return failed();
    }
    if (!(await source.clearData(profile.id)).ok) return failed();
    const next = list.filter((one) => one.id !== profile.id);
    const done = await source.saveProfiles(next);
    if (done.ok) setSaved(next);
    else failed();
  }

  const editor = (
    <li className={styles.line} data-profile-form="">
      <div className={styles.lineMain}>
        {editing?.fields === "color" ? null : (
          <Field label={t("settings.label.profile-name")}>
            <Input
              value={form.name}
              autoFocus
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
        )}
        {editing?.fields === "name" ? null : (
          <Field label={t("settings.label.profile-color")}>
            <SwatchPicker
              label={t("settings.label.profile-color")}
              value={form.color}
              options={AGENT_CHARACTER_COLORS.map((color) => ({
                value: color,
                label: t(PROFILE_COLOR_LABEL[color]),
                swatch: CHARACTER_COLORS[color],
              }))}
              onValueChange={(color) =>
                setForm({
                  ...form,
                  color: color as BrowserProfile["color"],
                })
              }
            />
          </Field>
        )}
        {error === null ? null : (
          <p className={styles.rejected} role="alert" data-profile-error="">
            {error === "invalid"
              ? t("settings.error.profile-invalid")
              : t("settings.error.profile-failed")}
          </p>
        )}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button onClick={() => setEditing(null)}>
            {t("settings.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            data-profile-save=""
            onClick={() => void submit()}
          >
            {t("settings.button.profile-save")}
          </Button>
        </div>
      </div>
    </li>
  );

  const deletingLogins = deleting === null ? null : loginsOf(deleting);
  return (
    <>
      {deleteFailed === null ? null : (
        <p className={styles.rejected} role="alert" data-profile-error="">
          {t("settings.error.profile-delete-failed", { name: deleteFailed })}
        </p>
      )}
      <ul className={styles.lines} data-profiles="ok">
        <li className={styles.line} data-profile="default">
          <div className={styles.lineMain}>
            <span className={styles.productName}>
              <span
                style={{
                  flex: "none",
                  width: "var(--space-3)",
                  height: "var(--space-3)",
                  borderRadius: "var(--radius-full)",
                  border: "var(--border-width) solid var(--color-text-muted)",
                }}
              />
              {t("settings.label.profile-default")}
            </span>
            <span className={styles.lineHelp}>
              {t("settings.note.profile-default")}
            </span>
          </div>
        </li>
        {list.map((profile) => {
          if (editing?.id === profile.id) {
            return <Fragment key={profile.id}>{editor}</Fragment>;
          }
          const names = agentNames(profile);
          return (
            <li
              key={profile.id}
              className={styles.line}
              data-profile={profile.id}
            >
              <div className={styles.lineMain}>
                <span className={styles.productName}>
                  <ProfileMark profile={profile} />
                  {profile.name}
                </span>
                {names === null ? null : (
                  <span className={styles.lineHelp} data-profile-agents="">
                    {names === ""
                      ? t("settings.notice.profile-no-agents")
                      : t("settings.text.profile-agents", { agents: names })}
                  </span>
                )}
              </div>
              <div className={styles.lineControl}>
                <div className={styles.actions}>
                  <Button
                    icon={actionIcons.edit}
                    data-profile-rename=""
                    onClick={() =>
                      open({ id: profile.id, fields: "name" }, profile)
                    }
                  >
                    {t("settings.button.profile-rename")}
                  </Button>
                  <Button
                    icon={actionIcons.edit}
                    data-profile-color=""
                    onClick={() =>
                      open({ id: profile.id, fields: "color" }, profile)
                    }
                  >
                    {t("settings.button.profile-color")}
                  </Button>
                  <Button
                    icon={actionIcons.delete}
                    data-profile-clear=""
                    onClick={() => onClear(profile)}
                  >
                    {t("settings.button.profile-clear")}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={actionIcons.delete}
                    data-profile-delete=""
                    // login을 세지 못하면 어느 login을 지울지 모른다.
                    disabled={loginsOf(profile) === null}
                    onClick={() => setDeleting(profile)}
                  >
                    {t("settings.button.profile-delete")}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
        {editing?.id === null ? editor : null}
      </ul>
      {editing === null ? (
        <div className={styles.actions}>
          <Button
            icon={actionIcons.add}
            data-profile-add=""
            disabled={list.length >= BROWSER_PROFILES_MAX}
            onClick={() => open({ id: null, fields: "both" }, null)}
          >
            {t("settings.button.profile-add")}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={t("settings.title.profile-delete", {
          name: deleting?.name ?? "",
        })}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.delete}
              data-profile-delete-confirm=""
              onClick={() => void remove(deleting!)}
            >
              {t("settings.button.profile-delete-confirm")}
            </Button>
          </>
        }
      >
        <p>
          {t("settings.note.profile-delete-confirm", {
            logins: deletingLogins?.length ?? 0,
          })}
        </p>
        <p>{t("settings.note.profile-delete-agents")}</p>
      </Dialog>
    </>
  );
}
