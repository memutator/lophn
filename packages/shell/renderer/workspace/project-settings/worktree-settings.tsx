// Project settings › Worktrees. project별 worktree 준비 설정(정한 것 11)을 사람이 쓴다: 새 worktree로 복사할 git이 무시하는 파일의 규칙,
// 만든 뒤·지우기 전에 돌릴 Project Command, 만들 때 setup을 돌릴지. 저장소의 `.worktreeinclude`는 읽어서 보이기만 하고 사람이 골라 더한다.
import { t } from "@lophn/i18n";
import { Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import { Field, Input, Select, Switch } from "@lophn/ui/input";
import { Button, IconButton } from "@lophn/ui/primitives";
import { useEffect, useMemo, useState } from "react";
import type {
  WorktreeIncludeCandidate,
  WorktreeSettings,
} from "../../../../protocol/projects/worktrees.ts";
import { useMachineData } from "../../desktop/machines/scope.tsx";
import { actionIcons, commonIcons } from "../../icons/mod.ts";
import { useProjectCommandsState } from "../project-commands/use-project-commands.ts";
import { createWorktreesSource } from "../worktrees/source.ts";
import styles from "./worktree-settings.module.css";

// Radix Select는 빈 값을 받지 않아 "없음"을 따로 적는다. command id는 `-`로 시작할 수 없어 겹치지 않는다.
const NONE = "-";

export function WorktreeSettingsSection({ projectId }: { projectId: string }) {
  const data = useMachineData();
  const source = useMemo(() => createWorktreesSource(data.core), [data.core]);
  const commands = useProjectCommandsState(data, projectId);
  const [settings, setSettings] = useState<WorktreeSettings | null>(null);
  const [draft, setDraft] = useState<WorktreeSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pattern, setPattern] = useState("");
  const [detected, setDetected] = useState<
    readonly WorktreeIncludeCandidate[] | null
  >(null);
  const showLoading = useDelayedLoading(settings === null && failed === null);

  useEffect(() => {
    let live = true;
    void source.settings(projectId).then((read) => {
      if (!live) return;
      if (!read.ok) {
        setFailed(read.error.message);
        return;
      }
      setSettings(read.value.settings);
      setDraft(read.value.settings);
    });
    return () => {
      live = false;
    };
  }, [source, projectId]);

  if (draft === null || settings === null) {
    if (failed !== null) {
      return (
        <p className={styles.error} role="alert">
          {t("worktree-open.error.settings-load", { message: failed })}
        </p>
      );
    }
    return showLoading ? <Skeleton lines={3} /> : null;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const change = (next: Partial<WorktreeSettings>) => {
    setSaved(false);
    setDraft({ ...draft, ...next });
  };
  const addPattern = (value: string) => {
    const clean = value.trim();
    if (clean === "" || draft.copy_patterns.includes(clean)) return;
    change({ copy_patterns: [...draft.copy_patterns, clean] });
  };
  const save = async () => {
    setSaving(true);
    const reply = await source.setSettings({
      project: projectId,
      settings: draft,
    });
    setSaving(false);
    if (!reply.ok) {
      setFailed(reply.error.message);
      return;
    }
    setFailed(null);
    setSettings(reply.value.settings);
    setDraft(reply.value.settings);
    setSaved(true);
  };
  const detect = async () => {
    const reply = await source.detectInclude(projectId);
    setDetected(reply.ok ? reply.value.patterns : []);
    if (!reply.ok) setFailed(reply.error.message);
  };
  // 지워진 명령을 가리키는 값도 그대로 보인다(저장하면 core가 거른다).
  const commandOptions = [
    { value: NONE, label: t("worktree-open.label.no-command") },
    ...commands.commands.map((cmd) => ({ value: cmd.id, label: cmd.name })),
  ];
  const commandValue = (id: string | null) => (id === null ? NONE : id);

  return (
    <div className={styles.root} data-worktree-settings="">
      <div className={styles.block}>
        <span className={styles.label}>
          {t("worktree-open.label.copy-patterns")}
        </span>
        <p className={styles.note}>{t("worktree-open.note.copy-patterns")}</p>
        {draft.copy_patterns.length === 0 ? (
          <p className={styles.note}>
            {t("worktree-open.empty.copy-patterns")}
          </p>
        ) : (
          <ul className={styles.list}>
            {draft.copy_patterns.map((one) => (
              <li key={one} className={styles.item} data-copy-pattern={one}>
                <code className={styles.code}>{one}</code>
                <IconButton
                  size="sm"
                  icon={actionIcons.delete}
                  label={t("worktree-open.button.remove-pattern", {
                    pattern: one,
                  })}
                  onClick={() =>
                    change({
                      copy_patterns: draft.copy_patterns.filter(
                        (item) => item !== one,
                      ),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className={styles.inline}>
          <Input
            size="sm"
            value={pattern}
            placeholder=".env*"
            spellCheck={false}
            aria-label={t("worktree-open.label.new-pattern")}
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                addPattern(pattern);
                setPattern("");
              }
            }}
          />
          <Button
            size="sm"
            icon={commonIcons.add}
            disabled={pattern.trim() === ""}
            onClick={() => {
              addPattern(pattern);
              setPattern("");
            }}
          >
            {t("worktree-open.button.add-pattern")}
          </Button>
          <Button size="sm" onClick={() => void detect()}>
            {t("worktree-open.button.detect-include")}
          </Button>
        </div>
        {detected === null ? null : detected.length === 0 ? (
          <p className={styles.note}>
            {t("worktree-open.empty.detect-include")}
          </p>
        ) : (
          <ul className={styles.list} data-worktree-include="">
            {detected.map((one) => (
              <li key={`${one.folder}:${one.pattern}`} className={styles.item}>
                <code className={styles.code}>{one.pattern}</code>
                <span className={styles.note}>{one.source}</span>
                <Button
                  size="sm"
                  disabled={draft.copy_patterns.includes(one.pattern)}
                  onClick={() => addPattern(one.pattern)}
                >
                  {draft.copy_patterns.includes(one.pattern)
                    ? t("worktree-open.button.pattern-added")
                    : t("worktree-open.button.import-pattern")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.twoCol}>
        <Field label={t("worktree-open.label.setup-command")}>
          <Select
            size="sm"
            value={commandValue(draft.setup_command)}
            options={commandOptions}
            onValueChange={(value) =>
              change({ setup_command: value === NONE ? null : value })
            }
          />
        </Field>
        <Field label={t("worktree-open.label.teardown-command")}>
          <Select
            size="sm"
            value={commandValue(draft.teardown_command)}
            options={commandOptions}
            onValueChange={(value) =>
              change({ teardown_command: value === NONE ? null : value })
            }
          />
        </Field>
      </div>
      <p className={styles.note}>{t("worktree-open.note.setup-teardown")}</p>
      <Switch
        label={t("worktree-open.label.run-setup")}
        checked={draft.run_setup}
        onCheckedChange={(checked) => change({ run_setup: checked })}
      />
      <div className={styles.inline}>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving
            ? t("worktree-open.button.saving")
            : t("worktree-open.button.save")}
        </Button>
        {saved && !dirty ? (
          <span className={styles.note} role="status">
            {t("worktree-open.notice.saved")}
          </span>
        ) : null}
        {failed === null ? null : (
          <span className={styles.error} role="alert">
            {failed}
          </span>
        )}
      </div>
    </div>
  );
}
