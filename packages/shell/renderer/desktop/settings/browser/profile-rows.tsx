// Settings › Browser의 Profiles 구역. 맨 위가 기본 profile(지우지 못한다)이고 아래가 사람이 만든 profile이다.
// 목록은 core의 vault이고 profile 하나씩 저장한다. 저장이 끝나야 줄이 바뀌고 열리므로 막 만든 profile은 core가 받은 뒤에야
// 보인다. 지우기는 partition data를 먼저 지우고 그다음 core가 그 profile의 login과 profile을 지운다. 중간에 실패하면 멈춘다
// (profile이 남아 있어 다시 할 수 있다).

import { t } from "@lophn/i18n";
import { Field, Input, SwatchPicker } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AGENT_CHARACTER_COLORS } from "../../../../../protocol/lophn-agent/agent-avatar.ts";
import { agentList } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { browserProfilesList } from "../../../../../protocol/secrets/browser-vault.ts";
import { BROWSER_PROFILES_MAX } from "../../../../../protocol/shell/browser-profiles.ts";
import { ProfileMark } from "../../../browser/browser-chrome.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import { CHARACTER_COLORS } from "../../../parts/avatar/character.tsx";
import { useCoreRead } from "../../connection/core-read.ts";
import styles from "../settings.module.css";
import { useLoginRows } from "./login-rows.tsx";
import { useSharing } from "./share-row.tsx";
import { PROFILE_COLOR_LABEL } from "./model.ts";
import type { BrowserProfile, BrowserSettingsSource } from "./source.ts";

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
  const { loaded } = useCoreRead(browserProfilesList, {});
  const read = useMemo(
    () => (loaded.state === "ready" ? loaded.value.profiles : null),
    [loaded],
  );
  // 저장한 목록은 다음에 읽은 값이 올 때까지 그대로 보인다.
  const [saved, setSaved] = useState<readonly BrowserProfile[] | null>(null);
  useEffect(() => setSaved(null), [read]);
  const agents = useCoreRead(agentList, {}).loaded;
  const logins = useLoginRows();
  const sharing = useSharing();
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

  async function submit(): Promise<void> {
    const name = form.name.trim();
    if (editing!.fields !== "color" && (name === "" || name.length > 40)) {
      return setError("invalid");
    }
    const current =
      editing!.id === null
        ? undefined
        : list.find((one) => one.id === editing!.id);
    const input = {
      ...(current === undefined ? {} : { id: current.id }),
      name: editing!.fields === "color" ? current!.name : name,
      color: editing!.fields === "name" ? current!.color : form.color,
    };
    const done = await source.saveProfile(input);
    if (!done.ok) {
      return setError(
        done.code === "conflict" || done.code === "invalid_input"
          ? "invalid"
          : "failed",
      );
    }
    setSaved(
      current === undefined
        ? [...list, { ...input, id: done.value }]
        : list.map((one) =>
            one.id === current.id ? { ...one, ...input } : one,
          ),
    );
    setEditing(null);
  }

  // ① partition data ② core가 그 profile의 login과 profile을 지운다. 앞이 실패하면 멈춘다.
  async function remove(profile: BrowserProfile): Promise<void> {
    setDeleting(null);
    setDeleteFailed(null);
    const failed = () => setDeleteFailed(profile.name);
    if (!(await source.clearData(profile.id)).ok) return failed();
    const done = await source.deleteProfile(profile.id);
    if (done.ok) setSaved(list.filter((one) => one.id !== profile.id));
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
        {sharing === true ? (
          <p data-profile-delete-shared="">
            {t("settings.note.delete-shared")}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
