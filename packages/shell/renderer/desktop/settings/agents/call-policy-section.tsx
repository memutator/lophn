// Settings › Agents의 한 절. agent가 보내는 call을 workspace 쌍과 agent 쌍으로 허용하거나 거절하는 목록이다.
// 줄마다 바로 저장하고, 저장하지 못하면 읽은 값으로 돌아가 오류를 보인다.
import { Field, Select } from "@lophn/ui/input";
import { Button, IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { actionIcons } from "../../../icons/mod.ts";
import styles from "../settings.module.css";
import type {
  CallPolicySource,
  CallPolicyView,
  CallRule,
  CallRuleList,
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
  const [view, setView] = useState<CallPolicyView | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback(() => {
    void source.read().then((read) => {
      if (alive.current && read.ok) setView(read.value);
    });
  }, [source]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  if (view === null) return null;

  async function save(next: {
    workspaces: readonly CallRule[];
    agents: readonly CallRule[];
  }) {
    setFailed(false);
    const saved = await source.write(next);
    if (!alive.current) return;
    if (!saved.ok) setFailed(true);
    load();
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
      <RuleList
        kind="workspaces"
        title={t("settings.label.call-workspaces")}
        list={view.workspaces}
        onChange={(rules) =>
          save({ workspaces: rules, agents: view.agents.rules })
        }
      />
      <RuleList
        kind="agents"
        title={t("settings.label.call-agents")}
        list={view.agents}
        onChange={(rules) =>
          save({ workspaces: view.workspaces.rules, agents: rules })
        }
      />
    </section>
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
