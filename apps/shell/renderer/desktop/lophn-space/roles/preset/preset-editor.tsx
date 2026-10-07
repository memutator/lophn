import { useState } from "react";
import { Button, Checkbox, Field, Input } from "@lophn/design/components";
import { type MessageKey, t } from "@lophn/wording";

import { changed } from "../model.ts";
import type {
  ContextChoice,
  ContextKind,
  PresetChoices,
  PresetDefinition,
  PresetEntry,
  RoleRow,
  RolesSource,
} from "../source.ts";
import { Disclose } from "../review/disclose.tsx";
import { ModelFields } from "./model-fields.tsx";
import styles from "../roles.module.css";

export interface PresetEditorProps {
  source: RolesSource;
  role: RoleRow;
  entry: PresetEntry;
  choices: PresetChoices;
  onCancel: () => void;
  onSaved: (saved: PresetEntry) => void;
}

const SIMPLE_CONTEXT: readonly {
  readonly kind: ContextKind;
  readonly label:
    | "roles.label.preset-context-all"
    | "roles.label.preset-context-work-place"
    | "roles.label.preset-context-scope";
}[] = [
  { kind: "all", label: "roles.label.preset-context-all" },
  { kind: "work_place", label: "roles.label.preset-context-work-place" },
  { kind: "assignment_scope", label: "roles.label.preset-context-scope" },
];

export const CONTEXT_LABEL = {
  all: "roles.label.preset-context-all",
  work_place: "roles.label.preset-context-work-place",
  assignment_scope: "roles.label.preset-context-scope",
  project: "roles.label.preset-context-project",
  app: "roles.label.preset-context-app",
  context: "roles.label.preset-context-focus",
  document: "roles.label.preset-context-document",
  sdk: "roles.label.preset-context-sdk",
} as const satisfies Record<ContextKind, MessageKey>;

function contextKey(item: ContextChoice): string {
  return `${item.kind}\0${item.target ?? ""}\0${item.section ?? ""}`;
}

type Problem = "save" | "changed" | null;

// Preset 편집. 계정 순서·model·context·skill·MCP server와 개별 tool을 고르고 저장하면 새 판이다.
// 기본 Preset은 사본으로 저장한다. 저장은 쓰는 판을 바꾸지 않고 적용은 목록에서 따로 한다.
export function PresetEditor(
  { source, role, entry, choices, onCancel, onSaved }: PresetEditorProps,
) {
  const [draft, setDraft] = useState<PresetDefinition>(
    entry.definition.origin === "product"
      ? {
        ...entry.definition,
        name: t("roles.label.preset-copy-name", {
          name: entry.definition.name,
        }),
      }
      : entry.definition,
  );
  const [skill, setSkill] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [saving, setSaving] = useState(false);
  const patch = (next: Partial<PresetDefinition>) =>
    setDraft((current) => ({ ...current, ...next }));

  const product = entry.definition.origin === "product";
  const dirty = product || changed(entry.definition, draft);

  const save = async () => {
    setSaving(true);
    const saved = await source.savePreset(
      role,
      entry,
      draft,
      note.trim() === "" ? t("roles.preset.default-reason") : note.trim(),
    );
    setSaving(false);
    if (saved.ok) onSaved(saved.value);
    else setProblem(saved.code === "conflict" ? "changed" : "save");
  };

  const addSkill = () => {
    const name = skill.trim();
    if (name === "" || draft.skills.includes(name)) return;
    patch({ skills: [...draft.skills, name] });
    setSkill("");
  };

  const toggleServer = (name: string, on: boolean) =>
    patch({
      servers: on
        ? [...draft.servers, name]
        : draft.servers.filter((server) => server !== name),
      tools: on
        ? draft.tools
        : draft.tools.filter((tool) => tool.server !== name),
    });

  const toggleTool = (server: string, tool: string, on: boolean) =>
    patch({
      tools: on
        ? [...draft.tools, { server, tool }]
        : draft.tools.filter((item) =>
          !(item.server === server && item.tool === tool)
        ),
    });

  return (
    <div className={styles.panel} data-preset-editor={entry.id}>
      <p className={styles.text}>
        {product
          ? t("roles.preset.edit-copy-intro")
          : t("roles.preset.edit-intro", { version: entry.revision })}
      </p>
      <Field label={t("roles.label.preset-name")}>
        <Input
          value={draft.name}
          onChange={(event) => patch({ name: event.currentTarget.value })}
        />
      </Field>

      <ModelFields
        source={source}
        choices={choices}
        use="decisions"
        pick={draft.decisions}
        onPick={(pick) => patch({ decisions: pick })}
      />
      <ModelFields
        source={source}
        choices={choices}
        use="summaries"
        pick={draft.summaries}
        onPick={(pick) => patch({ summaries: pick })}
      />

      <section className={styles.group} data-editor="context">
        <h3 className={styles.groupHead}>{t("roles.label.preset-context")}</h3>
        <ul className={styles.items}>
          {draft.context.map((item) => (
            <li
              key={contextKey(item)}
              className={styles.itemMain}
              data-context={item.kind}
            >
              <span>
                {t(CONTEXT_LABEL[item.kind])}
              </span>
              {item.target === null
                ? null
                : <span className={styles.muted}>{item.target}</span>}
              <Button
                size="sm"
                variant="ghost"
                data-action="remove-context"
                onClick={() =>
                  patch({
                    context: draft.context.filter((other) =>
                      contextKey(other) !== contextKey(item)
                    ),
                  })}
              >
                {t("roles.button.preset-remove")}
              </Button>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          {SIMPLE_CONTEXT.filter((option) =>
            !draft.context.some((item) => item.kind === option.kind)
          ).map((option) => (
            <Button
              key={option.kind}
              size="sm"
              variant="secondary"
              data-action="add-context"
              data-kind={option.kind}
              onClick={() =>
                patch({
                  context: [
                    ...draft.context,
                    { kind: option.kind, target: null, section: null },
                  ],
                })}
            >
              {t(option.label)}
            </Button>
          ))}
        </div>
      </section>

      <section className={styles.group} data-editor="skills">
        <h3 className={styles.groupHead}>{t("roles.label.preset-skills")}</h3>
        {draft.skills.length === 0
          ? <p className={styles.muted}>{t("roles.preset.no-skills")}</p>
          : (
            <ul className={styles.items}>
              {draft.skills.map((name) => (
                <li key={name} className={styles.itemMain} data-skill={name}>
                  <span>{name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="remove-skill"
                    onClick={() =>
                      patch({
                        skills: draft.skills.filter((other) =>
                          other !== name
                        ),
                      })}
                  >
                    {t("roles.button.preset-remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        <div className={styles.inline}>
          <Field
            label={t("roles.label.preset-skill-name")}
            help={t("roles.preset.skill-help")}
          >
            <Input
              value={skill}
              onChange={(event) => setSkill(event.currentTarget.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            data-action="add-skill"
            disabled={skill.trim() === ""}
            onClick={addSkill}
          >
            {t("roles.button.preset-add")}
          </Button>
        </div>
      </section>

      <section className={styles.group} data-editor="servers">
        <h3 className={styles.groupHead}>{t("roles.label.preset-servers")}</h3>
        {choices.servers.length === 0
          ? <p className={styles.muted}>{t("roles.preset.no-servers")}</p>
          : (
            <ul className={styles.items}>
              {choices.servers.map((server) => {
                const on = draft.servers.includes(server.name);
                const known = new Set(server.tools);
                const picked = draft.tools.filter((tool) =>
                  tool.server === server.name
                );
                const names = [
                  ...server.tools,
                  ...picked.map((tool) => tool.tool).filter((tool) =>
                    !known.has(tool)
                  ),
                ];
                return (
                  <li
                    key={server.name}
                    className={styles.fact}
                    data-server={server.name}
                  >
                    <Checkbox
                      label={server.name}
                      checked={on}
                      onCheckedChange={(checked) =>
                        toggleServer(server.name, checked)}
                    />
                    {!server.enabled
                      ? (
                        <span className={styles.muted}>
                          {t("roles.label.preset-server-off")}
                        </span>
                      )
                      : null}
                    {on
                      ? (
                        <div className={styles.kinds}>
                          {names.length === 0
                            ? (
                              <span className={styles.muted}>
                                {t("roles.preset.no-tools")}
                              </span>
                            )
                            : names.map((tool) => (
                              <Checkbox
                                key={tool}
                                label={tool}
                                checked={picked.some((item) =>
                                  item.tool === tool
                                )}
                                onCheckedChange={(checked) =>
                                  toggleTool(server.name, tool, checked)}
                              />
                            ))}
                        </div>
                      )
                      : null}
                  </li>
                );
              })}
            </ul>
          )}
        <p className={styles.muted}>{t("roles.preset.tools-help")}</p>
      </section>

      <Disclose name="internals" label={t("roles.label.preset-inside")}>
        <dl className={styles.facts}>
          <dt>{t("roles.label.preset-prompt")}</dt>
          <dd>{draft.internals.prompt.slice(0, 12)}</dd>
          <dt>{t("roles.label.preset-capabilities")}</dt>
          <dd>
            {[
              ...draft.internals.bundles.map((bundle) => bundle.name),
              ...draft.internals.capabilityTools,
            ].join(", ") || t("roles.label.preset-none")}
          </dd>
        </dl>
      </Disclose>

      {product ? null : (
        <Field label={t("roles.label.preset-reason")}>
          <Input
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </Field>
      )}

      {problem === null
        ? null
        : (
          <p className={styles.problem} data-editor-problem={problem}>
            {problem === "changed"
              ? t("roles.error.preset-changed")
              : t("roles.error.preset-save")}
          </p>
        )}
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="primary"
          data-action="save-preset"
          disabled={saving || !dirty || draft.name.trim() === ""}
          onClick={() => void save()}
        >
          {product
            ? t("roles.button.preset-save-copy")
            : t("roles.button.preset-save-version")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-action="cancel"
          onClick={onCancel}
        >
          {t("common.button.cancel")}
        </Button>
      </div>
    </div>
  );
}
