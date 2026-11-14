// Settings › Agents의 한 절. 다른 workspace와 call을 주고받지 않는 private workspace 목록과,
// agent가 보내는 call을 workspace 쌍과 agent 쌍으로 허용하거나 거절하는 목록이다.
// 줄마다 바로 저장하고, 저장하지 못하면 읽은 값으로 돌아가 오류를 보인다.
import { Field, Select } from "@lophn/ui/input";
import { Button, IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { appList } from "../../../../../protocol/apps/apps.ts";
import { settingsList } from "../../../../../protocol/config/file.ts";
import { CALL_POLICY_SETTING_KEY } from "../../../../../protocol/lophn-agent/call-policy.ts";
import { agentList } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import styles from "../settings.module.css";
import { callPolicyViewOf } from "./core-source.ts";
import type {
  CallPolicyChange,
  CallPolicySource,
  CallRule,
  CallRuleList,
  PrivateWorkspaces,
} from "./settings-source.ts";

const effectOptions = () => [
  { value: "allow", label: t("settings.label.call-allow") },
  { value: "refuse", label: t("settings.label.call-refuse") },
];

export function CallPolicySection({
  source,
}: {
  source: CallPolicySource;
}): ReactNode {
  // 정책과 고를 값(project, 앱, agent)은 다른 창이나 agent가 바꿔도 따라간다.
  const setting = useCoreRead(settingsList, {
    keys: [CALL_POLICY_SETTING_KEY],
  });
  const projects = useCoreRead(projectApi.list, { status: "active" });
  const apps = useCoreRead(appList, { status: "active" });
  const agents = useCoreRead(agentList, {});
  const view = useMemo(
    () =>
      setting.loaded.state === "ready" &&
      projects.loaded.state === "ready" &&
      apps.loaded.state === "ready" &&
      agents.loaded.state === "ready"
        ? callPolicyViewOf(
            effectiveOf(setting.loaded.value).get(CALL_POLICY_SETTING_KEY),
            projects.loaded.value.projects,
            apps.loaded.value.apps,
            agents.loaded.value.agents,
          )
        : null,
    [setting.loaded, projects.loaded, apps.loaded, agents.loaded],
  );
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (view === null) return null;

  const current: CallPolicyChange = {
    private: view.private.chosen,
    workspaces: view.workspaces.rules,
    agents: view.agents.rules,
  };

  async function save(next: CallPolicyChange) {
    setFailed(false);
    const saved = await source.write(next);
    if (!alive.current) return;
    if (!saved.ok) setFailed(true);
  }

  return (
    <section className={styles.groupBlock} data-call-policy="">
      <h2 className={styles.groupTitle}>{t("settings.heading.call-policy")}</h2>
      <p className={styles.lineHelp}>{t("settings.note.call-policy")}</p>
      {failed ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.value-not-saved")}
        </p>
      ) : null}
      <PrivateList
        list={view.private}
        onChange={(chosen) => save({ ...current, private: chosen })}
      />
      <RuleList
        kind="workspaces"
        title={t("settings.label.call-workspaces")}
        list={view.workspaces}
        onChange={(rules) => save({ ...current, workspaces: rules })}
      />
      <RuleList
        kind="agents"
        title={t("settings.label.call-agents")}
        list={view.agents}
        onChange={(rules) => save({ ...current, agents: rules })}
      />
    </section>
  );
}

function PrivateList({
  list,
  onChange,
}: {
  list: PrivateWorkspaces;
  onChange: (chosen: readonly string[]) => void;
}) {
  const { options, chosen } = list;
  const nameOf = (value: string) =>
    options.find((option) => option.value === value)?.label ?? value;
  const open = options.filter((option) => !chosen.includes(option.value));
  const [picked, setPicked] = useState("");
  const adding = open.some((option) => option.value === picked)
    ? picked
    : (open[0]?.value ?? "");
  return (
    <div data-private-workspaces="">
      <h3 className={styles.lineName}>{t("settings.label.call-private")}</h3>
      <p className={styles.lineHelp}>{t("settings.note.call-private")}</p>
      <ul className={styles.lines}>
        {chosen.length === 0 ? (
          <li className={`${styles.line} ${styles.lineHelp}`}>
            {t("settings.empty.call-private")}
          </li>
        ) : (
          chosen.map((value) => (
            <li
              key={value}
              className={styles.line}
              data-private-workspace={value}
            >
              <div className={styles.lineMain}>{nameOf(value)}</div>
              <div className={styles.lineControl}>
                <IconButton
                  icon={actionIcons.remove}
                  label={t("settings.button.remove-entry", {
                    item: nameOf(value),
                  })}
                  variant="ghost"
                  onClick={() =>
                    onChange(chosen.filter((one) => one !== value))
                  }
                />
              </div>
            </li>
          ))
        )}
        {open.length === 0 ? null : (
          <li className={styles.line} data-add-private-workspace="">
            <div className={styles.lineMain}>
              <Field label={t("settings.label.call-private-workspace")}>
                <Select
                  options={open}
                  value={adding}
                  onValueChange={setPicked}
                />
              </Field>
            </div>
            <div className={styles.lineControl}>
              <div className={styles.endSlot}>
                <Button
                  size="sm"
                  icon={actionIcons.add}
                  onClick={() => onChange([...chosen, adding])}
                >
                  {t("settings.button.add-call-rule")}
                </Button>
              </div>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}

function RuleList({
  kind,
  title,
  list,
  onChange,
}: {
  kind: string;
  title: string;
  list: CallRuleList;
  onChange: (rules: readonly CallRule[]) => void;
}) {
  const { options, rules } = list;
  const nameOf = (value: string) =>
    options.find((option) => option.value === value)?.label ?? value;
  const [from, setFrom] = useState(options[0]?.value ?? "");
  const [to, setTo] = useState(options[0]?.value ?? "");
  const [allow, setAllow] = useState(true);
  return (
    <div data-rules={kind}>
      <h3 className={styles.lineName}>{title}</h3>
      <ul className={styles.lines}>
        {rules.length === 0 ? (
          <li className={`${styles.line} ${styles.lineHelp}`}>
            {t("settings.empty.call-rules")}
          </li>
        ) : (
          rules.map((rule, index) => {
            const pair = t("settings.label.call-pair", {
              from: nameOf(rule.from),
              to: nameOf(rule.to),
            });
            return (
              <li
                key={`${rule.from}>${rule.to}`}
                className={styles.line}
                data-call-rule={`${rule.from}>${rule.to}`}
              >
                <div className={styles.lineMain}>{pair}</div>
                <div className={styles.lineControl}>
                  <Select
                    options={effectOptions()}
                    value={rule.allow ? "allow" : "refuse"}
                    onValueChange={(next) =>
                      onChange(
                        rules.map((one, at) =>
                          at === index
                            ? { ...one, allow: next === "allow" }
                            : one,
                        ),
                      )
                    }
                  />
                  <IconButton
                    icon={actionIcons.remove}
                    label={t("settings.button.remove-entry", { item: pair })}
                    variant="ghost"
                    onClick={() =>
                      onChange(rules.filter((_, at) => at !== index))
                    }
                  />
                </div>
              </li>
            );
          })
        )}
        <li className={styles.line} data-add-call-rule="">
          <div className={styles.lineMain}>
            <Field label={t("settings.label.call-from")}>
              <Select options={options} value={from} onValueChange={setFrom} />
            </Field>
            <Field label={t("settings.label.call-to")}>
              <Select options={options} value={to} onValueChange={setTo} />
            </Field>
          </div>
          <div className={styles.lineControl}>
            <Field label={t("settings.label.call-effect")}>
              <Select
                options={effectOptions()}
                value={allow ? "allow" : "refuse"}
                onValueChange={(next) => setAllow(next === "allow")}
              />
            </Field>
            <div className={styles.endSlot}>
              <Button
                size="sm"
                icon={actionIcons.add}
                disabled={from === "" || to === ""}
                onClick={() =>
                  onChange([
                    ...rules.filter(
                      (one) => !(one.from === from && one.to === to),
                    ),
                    { from, to, allow },
                  ])
                }
              >
                {t("settings.button.add-call-rule")}
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  );
}
