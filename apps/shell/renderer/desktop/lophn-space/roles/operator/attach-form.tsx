import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Field, Input, Textarea } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { Catalog } from "../../source.ts";
import { CONTEXT_LABEL } from "../preset/preset-editor.tsx";
import type { PresetEntry, RolesSource } from "../source.ts";
import { ApprovalWait, type Finished } from "./approval-wait.tsx";
import {
  DEFAULT_EVERY,
  defaultFirst,
  EVERY,
  type EveryKey,
  everyMs,
  localInput,
  startsLater,
  toIso,
} from "./period.ts";
import type {
  OperatorScope,
  OutputChoice,
  Proposed,
  ReadChoice,
} from "./source.ts";
import styles from "../roles.module.css";

export interface AttachFormProps {
  source: RolesSource;
  catalog: Catalog;
  /** 정해 두고 여는 자리(작업대의 [Attach an Operator]). 없으면 사람이 고른다. */
  initialScope?: OperatorScope;
  /** 지금 시각. 테스트가 고정한다. */
  now?: () => number;
  pollMs?: number;
  /** 끝났다. 붙었으면 새 역할의 id, 돌아가기만 했으면 null이다. */
  onDone: (assignment: string | null) => void;
}

type Stage =
  | { readonly kind: "edit" }
  | { readonly kind: "waiting"; readonly proposed: Proposed }
  | { readonly kind: "declined" }
  | { readonly kind: "failed" };

type Problem = "open" | "past" | null;

const key = (scope: OperatorScope) => `${scope.kind}:${scope.id}`;

// Operator 붙이기. 붙일 곳·Preset·읽을 자료(Preset의 context와 읽게 할 앱 명령)·보고할 문서·
// Repeating check를 정하고, 검토한 구성 전체는 보호 확인 창의 승인으로만 적용된다
// (flow set-up-operator, lophn-agent/assignments#R4·R5·R6, shell/confirmation-window#R5).
export function AttachForm(
  { source, catalog, initialScope, now = Date.now, pollMs, onDone }:
    AttachFormProps,
) {
  const operator = source.operator;
  const [scope, setScope] = useState<OperatorScope | null>(
    initialScope ?? null,
  );
  const [presets, setPresets] = useState<readonly PresetEntry[] | null>(null);
  const [preset, setPreset] = useState<PresetEntry | null>(null);
  const [documents, setDocuments] = useState<
    readonly OutputChoice[] | null
  >(null);
  const [content, setContent] = useState<Readonly<Record<string, string>>>({});
  const [apps, setApps] = useState<readonly string[]>([]);
  const [commands, setCommands] = useState<
    Readonly<Record<string, readonly ReadChoice[] | null>>
  >({});
  const [reads, setReads] = useState<readonly string[]>([]);
  const [every, setEvery] = useState<EveryKey>(DEFAULT_EVERY);
  const [first, setFirst] = useState(() => localInput(defaultFirst(now())));
  const [stage, setStage] = useState<Stage>({ kind: "edit" });
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void operator.presets().then((result) => {
      if (!live) return;
      const list = result.ok ? result.value : [];
      setPresets(list);
      setPreset((current) =>
        current ??
          list.find((entry) => entry.definition.origin === "product") ??
          list[0] ?? null
      );
    });
    return () => {
      live = false;
    };
  }, [operator]);

  useEffect(() => {
    setDocuments(null);
    setContent({});
    if (scope === null) return;
    let live = true;
    void operator.outputChoices(scope).then((result) => {
      if (live) setDocuments(result.ok ? result.value : []);
    });
    return () => {
      live = false;
    };
  }, [operator, scope === null ? "" : key(scope)]);

  const toggleApp = (app: string, on: boolean) => {
    setApps((current) =>
      on ? [...current, app] : current.filter((item) => item !== app)
    );
    if (!on) {
      setReads((current) => current.filter((item) => !item.startsWith(app)));
      return;
    }
    if (commands[app] !== undefined) return;
    setCommands((current) => ({ ...current, [app]: null }));
    void operator.readChoices(app).then((result) =>
      setCommands((current) => ({
        ...current,
        [app]: result.ok ? result.value : [],
      }))
    );
  };

  const readKey = (read: ReadChoice) => `${read.app}\0${read.command}`;
  const toggleRead = (read: ReadChoice, on: boolean) =>
    setReads((current) =>
      on
        ? [...current, readKey(read)]
        : current.filter((item) => item !== readKey(read))
    );

  const picked = useMemo(
    () => (documents ?? []).filter((doc) => content[doc.id] !== undefined),
    [documents, content],
  );
  const firstIso = toIso(first);
  const ready = scope !== null && preset !== null && picked.length > 0 &&
    picked.every((doc) => (content[doc.id] ?? "").trim().length > 0) &&
    firstIso !== null;

  const review = async () => {
    if (!ready || scope === null || preset === null || firstIso === null) {
      return;
    }
    if (!startsLater(firstIso, now())) {
      setProblem("past");
      return;
    }
    setBusy(true);
    setProblem(null);
    const chosen = Object.values(commands).flatMap((list) => list ?? []).filter(
      (read) => reads.includes(readKey(read)),
    );
    const proposed = await operator.propose({
      change: null,
      scope,
      preset,
      outputs: picked.map((doc) => ({
        document: doc.id,
        content: (content[doc.id] ?? "").trim(),
        version: doc.version,
      })),
      reads: chosen.map((read) => ({ app: read.app, command: read.command })),
      period: { firstAt: firstIso, everyMs: everyMs(every) },
    });
    setBusy(false);
    if (!proposed.ok) {
      setProblem("open");
      return;
    }
    setStage({ kind: "waiting", proposed: proposed.value });
  };

  const finished = (outcome: Finished) => {
    if (stage.kind !== "waiting") return;
    if (outcome === "attached") onDone(stage.proposed.assignment);
    else setStage({ kind: outcome });
  };

  const named = [...catalog.projects.map((item) => ({
    kind: "project" as const,
    ...item,
  })), ...catalog.apps.map((item) => ({ kind: "app" as const, ...item }))];

  if (stage.kind === "waiting") {
    return (
      <section className={styles.detail} data-attach="waiting">
        <h2 className={styles.title}>{t("roles.label.attach-title")}</h2>
        <ApprovalWait
          source={operator}
          proposed={stage.proposed}
          pollMs={pollMs}
          onFinished={finished}
        />
      </section>
    );
  }
  if (stage.kind === "declined" || stage.kind === "failed") {
    return (
      <section className={styles.detail} data-attach={stage.kind}>
        <h2 className={styles.title}>{t("roles.label.attach-title")}</h2>
        <p className={stage.kind === "failed" ? styles.problem : styles.notice}>
          {t(
            stage.kind === "failed"
              ? "roles.attach.failed"
              : "roles.attach.declined",
          )}
        </p>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            data-action="attach-back"
            onClick={() => setStage({ kind: "edit" })}
          >
            {t("roles.button.attach-cancel")}
          </Button>
        </div>
      </section>
    );
  }

  const presetContext = preset === null
    ? []
    : [...new Set(preset.definition.context.map((item) => item.kind))];

  return (
    <section className={styles.detail} data-attach="edit">
      <h2 className={styles.title}>{t("roles.label.attach-title")}</h2>
      <p className={styles.text}>{t("roles.attach.intro")}</p>
      <div className={styles.form}>
        <section className={styles.group} data-attach-section="where">
          <h3 className={styles.groupHead}>{t("roles.label.attach-where")}</h3>
          {initialScope === undefined
            ? (
              <div className={styles.choices}>
                {named.map((item) => (
                  <Button
                    key={`${item.kind}:${item.id}`}
                    size="sm"
                    variant={scope !== null && key(scope) ===
                        `${item.kind}:${item.id}`
                      ? "primary"
                      : "secondary"}
                    data-choice={`scope:${item.kind}:${item.id}`}
                    aria-pressed={scope !== null &&
                      key(scope) === `${item.kind}:${item.id}`}
                    onClick={() => setScope({ kind: item.kind, id: item.id })}
                  >
                    {item.title}
                  </Button>
                ))}
              </div>
            )
            : (
              <p className={styles.text} data-attach-fixed="">
                {named.find((item) =>
                  item.kind === initialScope.kind && item.id === initialScope.id
                )?.title ?? t("roles.label.attach-where-pick")}
              </p>
            )}
        </section>

        <section className={styles.group} data-attach-section="preset">
          <h3 className={styles.groupHead}>
            {t("roles.label.attach-preset")}
          </h3>
          {presets !== null && presets.length === 0
            ? <p className={styles.muted}>{t("roles.attach.no-preset")}</p>
            : (
              <div className={styles.choices}>
                {(presets ?? []).map((entry) => (
                  <Button
                    key={`${entry.id}:${entry.revision}`}
                    size="sm"
                    variant={preset?.id === entry.id &&
                        preset.revision === entry.revision
                      ? "primary"
                      : "secondary"}
                    data-choice={`preset:${entry.id}`}
                    aria-pressed={preset?.id === entry.id &&
                      preset.revision === entry.revision}
                    onClick={() => setPreset(entry)}
                  >
                    {t("roles.label.attach-preset-line", {
                      name: entry.definition.name,
                      version: entry.revision,
                    })}
                  </Button>
                ))}
              </div>
            )}
        </section>

        <section className={styles.group} data-attach-section="reads">
          <h3 className={styles.groupHead}>{t("roles.label.attach-reads")}</h3>
          <p className={styles.muted}>
            {t("roles.label.attach-reads-preset")}
          </p>
          <ul className={styles.items} data-attach-context="">
            {presetContext.map((kind) => (
              <li key={kind} className={styles.itemText}>
                {t(CONTEXT_LABEL[kind])}
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{t("roles.label.attach-apps")}</p>
          <div className={styles.kinds}>
            {catalog.apps.map((app) => (
              <div key={app.id} data-attach-app={app.id}>
                <Checkbox
                  label={app.title}
                  checked={apps.includes(app.id)}
                  onCheckedChange={(on) => toggleApp(app.id, on)}
                />
                {apps.includes(app.id)
                  ? (
                    <div className={styles.kinds}>
                      {(commands[app.id] ?? []).length === 0 &&
                          commands[app.id] !== null
                        ? (
                          <span className={styles.muted}>
                            {t("roles.attach.no-reads")}
                          </span>
                        )
                        : (commands[app.id] ?? []).map((read) => (
                          <Checkbox
                            key={read.command}
                            label={read.label}
                            checked={reads.includes(readKey(read))}
                            onCheckedChange={(on) => toggleRead(read, on)}
                          />
                        ))}
                    </div>
                  )
                  : null}
              </div>
            ))}
          </div>
        </section>

        <section className={styles.group} data-attach-section="outputs">
          <h3 className={styles.groupHead}>
            {t("roles.label.attach-outputs")}
          </h3>
          <p className={styles.muted}>{t("roles.attach.output-help")}</p>
          {scope !== null && documents !== null && documents.length === 0
            ? <p className={styles.muted}>{t("roles.attach.no-outputs")}</p>
            : null}
          <div className={styles.kinds}>
            {(documents ?? []).map((doc) => (
              <div key={doc.id} data-attach-output={doc.id}>
                <Checkbox
                  label={doc.title}
                  checked={content[doc.id] !== undefined}
                  onCheckedChange={(on) =>
                    setContent((current) => {
                      const next = { ...current };
                      if (on) next[doc.id] = "";
                      else delete next[doc.id];
                      return next;
                    })}
                />
                {content[doc.id] === undefined ? null : (
                  <Field label={t("roles.label.attach-output-content")}>
                    <Textarea
                      rows={3}
                      value={content[doc.id]}
                      onChange={(event) =>
                        setContent((current) => ({
                          ...current,
                          [doc.id]: event.target.value,
                        }))}
                    />
                  </Field>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={styles.group} data-attach-section="period">
          <h3 className={styles.groupHead}>
            {t("roles.label.attach-period")}
          </h3>
          <p className={styles.muted}>{t("roles.label.attach-every")}</p>
          <div className={styles.choices}>
            {EVERY.map((item) => (
              <Button
                key={item.key}
                size="sm"
                variant={every === item.key ? "primary" : "secondary"}
                data-choice={`every:${item.key}`}
                aria-pressed={every === item.key}
                onClick={() => setEvery(item.key)}
              >
                {t(item.label)}
              </Button>
            ))}
          </div>
          <Field
            label={t("roles.label.attach-first")}
            error={problem === "past" ? t("roles.attach.past-start") : undefined}
          >
            <Input
              type="datetime-local"
              value={first}
              data-attach-first=""
              onChange={(event) => {
                setFirst(event.target.value);
                setProblem(null);
              }}
            />
          </Field>
        </section>

        {problem === "open"
          ? (
            <p className={styles.problem} data-attach-problem="open">
              {t("roles.attach.open-failed")}
            </p>
          )
          : null}
        <div className={styles.actions}>
          <Button
            variant="primary"
            data-action="attach-review"
            disabled={!ready || busy}
            onClick={() => void review()}
          >
            {t("roles.button.attach-review")}
          </Button>
          <Button
            variant="ghost"
            data-action="attach-cancel"
            onClick={() => onDone(null)}
          >
            {t("roles.button.attach-cancel")}
          </Button>
        </div>
      </div>
    </section>
  );
}
