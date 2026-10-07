import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  lophnSpaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type {
  PresetChoices,
  PresetEntry,
  RoleRow,
  RolesSource,
} from "../source.ts";
import { Disclose } from "../review/disclose.tsx";
import { PresetEditor } from "./preset-editor.tsx";
import styles from "../roles.module.css";

export interface PresetPanelProps {
  source: RolesSource;
  role: RoleRow;
  connected: number;
  /** 적용한 뒤 목록을 다시 읽는다. */
  onChanged: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly entries: readonly PresetEntry[] };

type Notice =
  | { readonly kind: "saved"; readonly version: number }
  | { readonly kind: "applied" }
  | { readonly kind: "apply-failed" }
  | null;

// Preset. 역할마다 기본 Preset과 사람이 고친 판이 있고, 저장은 새 판이며 쓰는 것은 명시 적용한 판뿐이다
// (flow add-agent-extension, lophn-agent/presets#R11, R12). 안쪽 구성은 펼친 자리에만 둔다.
export function PresetPanel(
  { source, role, connected, onChanged }: PresetPanelProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [choices, setChoices] = useState<PresetChoices | null>(null);
  const [editing, setEditing] = useState<PresetEntry | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void source.presets(role).then((result) => {
      if (!live) return;
      setLoaded((previous) =>
        result.ok
          ? { kind: "ready", entries: result.value }
          : previous.kind === "ready"
          ? previous
          : { kind: "failed" }
      );
    });
    return () => {
      live = false;
    };
  }, [source, role, connected, attempt]);

  const edit = async (entry: PresetEntry) => {
    const read = await source.choices();
    setChoices(read.ok ? read.value : { connections: [], servers: [] });
    setNotice(null);
    setEditing(entry);
  };

  const apply = async (entry: PresetEntry, revision: number) => {
    const applied = await source.applyPreset(role, entry.id, revision);
    setNotice(applied.ok ? { kind: "applied" } : { kind: "apply-failed" });
    if (applied.ok) onChanged();
  };

  if (editing !== null && choices !== null) {
    return (
      <PresetEditor
        source={source}
        role={role}
        entry={editing}
        choices={choices}
        onCancel={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          setNotice({ kind: "saved", version: saved.revision });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  const inUse = (entry: PresetEntry, revision: number) =>
    role.preset.id === entry.id && role.preset.revision === revision;
  // Operator에 붙이는 변경은 project나 app·출력·주기를 포함한 보호된 승인이라 이 화면이 적용하지 않는다.
  const canApply = role.role !== "operator" && role.state !== "withdrawn";

  return (
    <div className={styles.panel} data-preset-panel="">
      <p className={styles.text}>{t("roles.preset.intro")}</p>
      {notice?.kind === "saved"
        ? (
          <p className={styles.notice} data-preset-notice="saved">
            {t("roles.preset.saved", { version: notice.version })}
          </p>
        )
        : null}
      {notice?.kind === "applied"
        ? (
          <p className={styles.notice} data-preset-notice="applied">
            {t("roles.preset.applied")}
          </p>
        )
        : null}
      {notice?.kind === "apply-failed"
        ? (
          <p className={styles.problem} data-preset-notice="apply-failed">
            {t("roles.error.apply")}
          </p>
        )
        : null}
      {!canApply && role.role === "operator"
        ? <p className={styles.muted}>{t("roles.preset.operator-note")}</p>
        : null}
      {loaded.kind === "failed"
        ? (
          <ErrorState
            target={t("roles.label.target-preset")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        )
        : null}
      {loaded.kind === "ready" && loaded.entries.length === 0
        ? (
          <EmptyState
            icon={lophnSpaceIcons.roles}
            message={t("roles.empty.no-preset")}
            action={{
              label: t("roles.button.reload"),
              onSelect: () => setAttempt((value) => value + 1),
            }}
          />
        )
        : null}
      {loaded.kind === "ready"
        ? (
          <ul className={styles.items}>
            {[...loaded.entries]
              .sort((a, b) =>
                Number(b.definition.origin === "product") -
                  Number(a.definition.origin === "product") ||
                a.definition.name.localeCompare(b.definition.name)
              )
              .map((entry) => (
                <li
                  key={entry.id}
                  className={styles.card}
                  data-preset={entry.id}
                  data-origin={entry.definition.origin}
                >
                  <div className={styles.itemMain}>
                    <span className={styles.itemText}>
                      {entry.definition.name}
                    </span>
                    <span className={styles.tag}>
                      {entry.definition.origin === "product"
                        ? t("roles.label.preset-default")
                        : t("roles.label.preset-yours")}
                    </span>
                    <span className={styles.muted}>
                      {t("roles.label.preset-version", {
                        version: entry.revision,
                      })}
                    </span>
                    {inUse(entry, entry.revision)
                      ? (
                        <span className={styles.tag} data-in-use="">
                          {t("roles.label.preset-in-use")}
                        </span>
                      )
                      : null}
                  </div>
                  {entry.definition.decisions === null
                    ? null
                    : (
                      <p className={styles.muted}>
                        {t("roles.label.preset-decisions-model", {
                          model: entry.definition.decisions.model,
                        })}
                      </p>
                    )}
                  <div className={styles.actions}>
                    {canApply && !inUse(entry, entry.revision)
                      ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-action="apply"
                          onClick={() => void apply(entry, entry.revision)}
                        >
                          {t("roles.button.preset-apply")}
                        </Button>
                      )
                      : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      data-action="edit"
                      onClick={() => void edit(entry)}
                    >
                      {entry.definition.origin === "product"
                        ? t("roles.button.preset-customize")
                        : t("roles.button.preset-edit")}
                    </Button>
                  </div>
                  {entry.revision > 1
                    ? (
                      <Disclose
                        name={`earlier-${entry.id}`}
                        label={t("roles.label.preset-earlier")}
                      >
                        <ul className={styles.items}>
                          {Array.from(
                            { length: entry.revision - 1 },
                            (_, index) => entry.revision - 1 - index,
                          ).map((revision) => (
                            <li key={revision} className={styles.itemMain}>
                              <span>
                                {t("roles.label.preset-version", {
                                  version: revision,
                                })}
                              </span>
                              {inUse(entry, revision)
                                ? (
                                  <span className={styles.tag}>
                                    {t("roles.label.preset-in-use")}
                                  </span>
                                )
                                : canApply
                                ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    data-action="apply-earlier"
                                    onClick={() => void apply(entry, revision)}
                                  >
                                    {t("roles.button.preset-apply")}
                                  </Button>
                                )
                                : null}
                            </li>
                          ))}
                        </ul>
                      </Disclose>
                    )
                    : null}
                  <Disclose
                    name={`inside-${entry.id}`}
                    label={t("roles.label.preset-inside")}
                  >
                    <dl className={styles.facts}>
                      <dt>{t("roles.label.preset-prompt")}</dt>
                      <dd>{entry.definition.internals.prompt.slice(0, 12)}</dd>
                      <dt>{t("roles.label.preset-capabilities")}</dt>
                      <dd>
                        {[
                          ...entry.definition.internals.bundles.map((bundle) =>
                            bundle.name
                          ),
                          ...entry.definition.internals.capabilityTools,
                        ].join(", ") || t("roles.label.preset-none")}
                      </dd>
                      <dt>{t("roles.label.preset-instructions")}</dt>
                      <dd>{entry.definition.internals.instructions}</dd>
                    </dl>
                  </Disclose>
                </li>
              ))}
          </ul>
        )
        : null}
    </div>
  );
}
