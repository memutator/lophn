// Project settings › Commands 편집기.
// project의 agent 기본 설정(쓸 수 있는 agent, ask before run, 정의 쓰기 승인)과
// 명령 목록(이름·여러 줄 명령·kind·icon·기준 폴더/cwd·env·preview_url/auto_open_preview·timeout_ms·명령별 agent 덮어쓰기),
// 그리고 프로젝트 폴더 감지(Detect from project) → 골라 가져오기를 제공한다.
import { t } from "@lophn/i18n";
import { Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import {
  Checkbox,
  Field,
  Input,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
} from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { useMemo, useState } from "react";
import { projectApi } from "../../../../protocol/projects/project-api.ts";
import {
  type CommandKind,
  type DetectedCommandCandidate,
  PROJECT_COMMANDS_MAX,
  type ProjectCommand,
  type ProjectCommandInput,
  type ProjectCommandSettings,
} from "../../../../protocol/projects/project-commands.ts";
import { useCoreRead } from "../../desktop/connection/core-read.ts";
import { useMachineData } from "../../desktop/machines/scope.tsx";
import {
  actionIcons,
  projectCommandActionIcons,
  projectCommandIcon,
} from "../../icons/mod.ts";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";
import styles from "./commands-settings.module.css";
import { createProjectCommandsSource } from "./source.ts";
import { useProjectCommandsState } from "./use-project-commands.ts";

interface EnvDraft {
  id: number;
  key: string;
  value: string;
}

interface CommandDraft {
  name: string;
  command: string;
  kind: CommandKind;
  description: string;
  folder_ref: string;
  cwd: string;
  env: EnvDraft[];
  preview_url: string;
  auto_open_preview: boolean;
  timeout_ms: string;
  agentsMode: "inherit" | "all" | "selected";
  selectedAgents: string[];
  askMode: "inherit" | "on" | "off";
}

let envDraftSeq = 1;

function draftFromCommand(
  cmd?: ProjectCommand,
  defaultFolder?: string,
): CommandDraft {
  if (cmd === undefined) {
    return {
      name: "",
      command: "",
      kind: "action",
      description: "",
      folder_ref: defaultFolder ?? "",
      cwd: "",
      env: [],
      preview_url: "",
      auto_open_preview: false,
      timeout_ms: "",
      agentsMode: "inherit",
      selectedAgents: [],
      askMode: "inherit",
    };
  }
  const envEntries = Object.entries(cmd.env ?? {}).map(([key, value]) => ({
    id: envDraftSeq++,
    key,
    value,
  }));
  return {
    name: cmd.name,
    command: cmd.command,
    kind: cmd.kind,
    description: cmd.description ?? "",
    folder_ref: cmd.folder_ref ?? defaultFolder ?? "",
    cwd: cmd.cwd ?? "",
    env: envEntries,
    preview_url: cmd.preview_url ?? "",
    auto_open_preview: cmd.auto_open_preview === true,
    timeout_ms: cmd.timeout_ms === undefined ? "" : String(cmd.timeout_ms),
    agentsMode:
      cmd.agents === undefined
        ? "inherit"
        : cmd.agents === "all"
          ? "all"
          : "selected",
    selectedAgents: Array.isArray(cmd.agents) ? [...cmd.agents] : [],
    askMode:
      cmd.ask_before_run === undefined
        ? "inherit"
        : cmd.ask_before_run
          ? "on"
          : "off",
  };
}

function buildInputFromDraft(draft: CommandDraft): ProjectCommandInput {
  const envRecord: Record<string, string> = {};
  for (const row of draft.env) {
    const key = row.key.trim();
    if (key.length > 0) envRecord[key] = row.value;
  }
  const timeoutParsed =
    draft.kind === "action" && draft.timeout_ms.trim() !== ""
      ? Number.parseInt(draft.timeout_ms.trim(), 10)
      : undefined;
  return {
    name: draft.name.trim(),
    command: draft.command.trim(),
    kind: draft.kind,
    ...(draft.description.trim() === ""
      ? {}
      : { description: draft.description.trim() }),
    ...(draft.folder_ref === "" ? {} : { folder_ref: draft.folder_ref }),
    ...(draft.cwd.trim() === "" ? {} : { cwd: draft.cwd.trim() }),
    ...(Object.keys(envRecord).length > 0 ? { env: envRecord } : {}),
    ...(draft.preview_url.trim() === ""
      ? {}
      : { preview_url: draft.preview_url.trim() }),
    ...(draft.auto_open_preview ? { auto_open_preview: true } : {}),
    ...(timeoutParsed !== undefined &&
    Number.isFinite(timeoutParsed) &&
    timeoutParsed >= 1000
      ? { timeout_ms: timeoutParsed }
      : {}),
    ...(draft.agentsMode === "inherit"
      ? {}
      : {
          agents:
            draft.agentsMode === "all" ? "all" : [...draft.selectedAgents],
        }),
    ...(draft.askMode === "inherit"
      ? {}
      : { ask_before_run: draft.askMode === "on" }),
  };
}

function CommandForm({
  initial,
  folders,
  agents,
  busy,
  onSave,
  onCancel,
}: {
  initial: CommandDraft;
  folders: readonly { readonly ref: string; readonly label: string }[];
  agents: readonly SidebarAgent[];
  busy: boolean;
  onSave: (draft: CommandDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CommandDraft>(initial);
  const canSave = draft.name.trim() !== "" && draft.command.trim() !== "";

  return (
    <div className={styles.formGrid} data-command-form="">
      <div className={styles.twoCol}>
        <Field label={t("project-settings.label.command-name")}>
          <Input
            size="sm"
            value={draft.name}
            maxLength={60}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label={t("project-settings.label.command-kind")}>
          <SegmentedControl
            size="sm"
            label={t("project-settings.label.command-kind")}
            options={[
              {
                value: "action",
                label: t("project-settings.label.command-kind-action"),
              },
              {
                value: "service",
                label: t("project-settings.label.command-kind-service"),
              },
            ]}
            value={draft.kind}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                kind: value === "service" ? "service" : "action",
              })
            }
          />
        </Field>
      </div>

      <Field label={t("project-settings.label.command-line")}>
        <Textarea
          rows={3}
          value={draft.command}
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
        />
      </Field>

      <div className={styles.twoCol}>
        {folders.length > 0 ? (
          <Field label={t("project-settings.label.command-folder")}>
            <Select
              size="sm"
              value={draft.folder_ref || folders[0]!.ref}
              options={folders.map((f) => ({ value: f.ref, label: f.label }))}
              onValueChange={(value) =>
                setDraft({ ...draft, folder_ref: value })
              }
            />
          </Field>
        ) : null}
        <Field label={t("project-settings.label.command-cwd")}>
          <Input
            size="sm"
            value={draft.cwd}
            placeholder="."
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
          />
        </Field>
      </div>

      <Field label={t("project-settings.label.command-description")}>
        <Input
          size="sm"
          value={draft.description}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </Field>

      <div className={styles.twoCol}>
        <Field label={t("project-settings.label.command-preview-url")}>
          <Input
            size="sm"
            value={draft.preview_url}
            placeholder="http://localhost:3000"
            spellCheck={false}
            onChange={(e) =>
              setDraft({ ...draft, preview_url: e.target.value })
            }
          />
        </Field>
        {draft.kind === "action" ? (
          <Field label={t("project-settings.label.command-timeout")}>
            <Input
              size="sm"
              type="number"
              min={1000}
              max={86400000}
              value={draft.timeout_ms}
              placeholder="600000"
              onChange={(e) =>
                setDraft({ ...draft, timeout_ms: e.target.value })
              }
            />
          </Field>
        ) : null}
      </div>

      <Switch
        size="sm"
        label={t("project-settings.label.auto-open-preview")}
        checked={draft.auto_open_preview}
        onCheckedChange={(checked) =>
          setDraft({ ...draft, auto_open_preview: checked })
        }
      />

      <div className={styles.envRows}>
        <span className={styles.cardTitle}>
          {t("project-settings.label.command-env")}
        </span>
        {draft.env.map((row) => (
          <div key={row.id} className={styles.envRow}>
            <Field label={t("project-settings.label.command-env-key")}>
              <Input
                size="sm"
                placeholder={t("project-settings.label.command-env-key")}
                value={row.key}
                spellCheck={false}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    env: draft.env.map((r) =>
                      r.id === row.id ? { ...r, key: e.target.value } : r,
                    ),
                  })
                }
              />
            </Field>
            <Field label={t("project-settings.label.command-env-value")}>
              <Input
                size="sm"
                placeholder={t("project-settings.label.command-env-value")}
                value={row.value}
                spellCheck={false}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    env: draft.env.map((r) =>
                      r.id === row.id ? { ...r, value: e.target.value } : r,
                    ),
                  })
                }
              />
            </Field>
            <IconButton
              icon={actionIcons.remove}
              label={t("project-settings.button.remove-command")}
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  env: draft.env.filter((r) => r.id !== row.id),
                })
              }
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            icon={actionIcons.add}
            onClick={() =>
              setDraft({
                ...draft,
                env: [...draft.env, { id: envDraftSeq++, key: "", value: "" }],
              })
            }
          >
            {t("project-settings.label.command-env-add")}
          </Button>
        </div>
      </div>

      <div className={styles.twoCol}>
        <Field label={t("project-settings.label.agent-policy")}>
          <SegmentedControl
            size="sm"
            label={t("project-settings.label.agent-policy")}
            options={[
              {
                value: "inherit",
                label: t("project-settings.label.agents-inherit"),
              },
              { value: "all", label: t("project-settings.label.agents-all") },
              {
                value: "selected",
                label: t("project-settings.label.agents-selected"),
              },
            ]}
            value={draft.agentsMode}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                agentsMode:
                  value === "all" || value === "selected" ? value : "inherit",
              })
            }
          />
        </Field>
        <Field label={t("project-settings.label.agent-ask-before-run")}>
          <SegmentedControl
            size="sm"
            label={t("project-settings.label.agent-ask-before-run")}
            options={[
              {
                value: "inherit",
                label: t("project-settings.label.ask-inherit"),
              },
              { value: "off", label: t("project-settings.label.ask-off") },
              { value: "on", label: t("project-settings.label.ask-on") },
            ]}
            value={draft.askMode}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                askMode: value === "on" || value === "off" ? value : "inherit",
              })
            }
          />
        </Field>
      </div>

      {draft.agentsMode === "selected" && agents.length > 0 ? (
        <div className={styles.agentChecks}>
          {agents.map((agent) => {
            const checked = draft.selectedAgents.includes(agent.assignment);
            return (
              <Checkbox
                key={agent.assignment}
                size="sm"
                label={agent.name}
                checked={checked}
                onCheckedChange={(next) =>
                  setDraft({
                    ...draft,
                    selectedAgents: next
                      ? [...draft.selectedAgents, agent.assignment]
                      : draft.selectedAgents.filter(
                          (id) => id !== agent.assignment,
                        ),
                  })
                }
              />
            );
          })}
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <Button
          size="sm"
          disabled={!canSave || busy}
          onClick={() => onSave(draft)}
        >
          {t("project-settings.button.save-command")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("project-settings.button.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function ProjectCommandsSettings({
  projectId,
  agents = [],
}: {
  readonly projectId: string;
  readonly agents?: readonly SidebarAgent[];
}) {
  const data = useMachineData();
  const source = useMemo(
    () => createProjectCommandsSource(data.core),
    [data.core],
  );
  const state = useProjectCommandsState(data, projectId, { includeEnv: true });
  const projectRead = useCoreRead(projectApi.get, { project: projectId });
  const folders = useMemo(() => {
    if (projectRead.loaded.state !== "ready") return [];
    return projectRead.loaded.value.project.folders.map((folder, index) => ({
      ref: `${projectId}_${index}`,
      label: folder.path.split(/[\\/]/).filter(Boolean).at(-1) ?? folder.path,
    }));
  }, [projectId, projectRead.loaded]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectCandidates, setDetectCandidates] = useState<
    readonly DetectedCommandCandidate[] | null
  >(null);
  const [detectNotes, setDetectNotes] = useState<readonly string[]>([]);
  const [pickedIndices, setPickedIndices] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const showLoading = useDelayedLoading(!state.loaded);
  if (!state.loaded) {
    return showLoading ? <Skeleton lines={4} /> : null;
  }

  const { commands, settings } = state;
  const projectAgentsMode = settings.agents === "all" ? "all" : "selected";
  const selectedProjectAgents = Array.isArray(settings.agents)
    ? settings.agents
    : [];

  const updateProjectSettings = async (next: ProjectCommandSettings) => {
    setBusy(true);
    setActionError(null);
    const res = await source.setSettings(projectId, next);
    setBusy(false);
    if (!res.ok) setActionError(res.error.message);
    else state.reload();
  };

  const runDetect = async () => {
    setDetecting(true);
    setActionError(null);
    const res = await source.detect(projectId);
    setDetecting(false);
    if (!res.ok) {
      setActionError(res.error.message);
      return;
    }
    setDetectCandidates(res.value.candidates);
    setDetectNotes(res.value.unsupported_notes);
    const initialPicked = new Set<number>();
    res.value.candidates.forEach((candidate, index) => {
      if (!candidate.already_registered) initialPicked.add(index);
    });
    setPickedIndices(initialPicked);
  };

  const importDetected = async () => {
    if (detectCandidates === null) return;
    const chosen: ProjectCommandInput[] = [];
    detectCandidates.forEach((c, index) => {
      if (!pickedIndices.has(index)) return;
      chosen.push({
        name: c.name,
        command: c.command,
        kind: c.kind,
        ...(c.description === undefined ? {} : { description: c.description }),
        ...(c.folder_ref === undefined ? {} : { folder_ref: c.folder_ref }),
        ...(c.cwd === undefined ? {} : { cwd: c.cwd }),
        ...(c.preview_url === undefined ? {} : { preview_url: c.preview_url }),
      });
    });
    if (chosen.length === 0) {
      setDetectCandidates(null);
      return;
    }
    setBusy(true);
    setActionError(null);
    const res = await source.importCommands(projectId, chosen);
    setBusy(false);
    if (!res.ok) {
      setActionError(res.error.message);
      return;
    }
    setDetectCandidates(null);
    state.reload();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= commands.length) return;
    const ids = commands.map((c) => c.id);
    const [item] = ids.splice(index, 1);
    ids.splice(target, 0, item!);
    setBusy(true);
    setActionError(null);
    const res = await source.reorder(projectId, ids);
    setBusy(false);
    if (!res.ok) setActionError(res.error.message);
    else state.reload();
  };

  return (
    <div className={styles.root} data-project-commands-settings="">
      {/* Project agent defaults */}
      <div className={styles.card} data-command-agent-settings="">
        <h3 className={styles.cardTitle}>
          {t("project-settings.label.agent-policy")}
        </h3>
        <SegmentedControl
          size="sm"
          label={t("project-settings.label.agent-policy")}
          options={[
            { value: "all", label: t("project-settings.label.agents-all") },
            {
              value: "selected",
              label: t("project-settings.label.agents-selected"),
            },
          ]}
          value={projectAgentsMode}
          onValueChange={(value) =>
            void updateProjectSettings({
              ...settings,
              agents:
                value === "all"
                  ? "all"
                  : selectedProjectAgents.length > 0
                    ? selectedProjectAgents
                    : [],
            })
          }
        />
        {projectAgentsMode === "selected" && agents.length > 0 ? (
          <div className={styles.agentChecks}>
            {agents.map((agent) => {
              const checked = selectedProjectAgents.includes(agent.assignment);
              return (
                <Checkbox
                  key={agent.assignment}
                  size="sm"
                  label={agent.name}
                  checked={checked}
                  onCheckedChange={(next) =>
                    void updateProjectSettings({
                      ...settings,
                      agents: next
                        ? [...selectedProjectAgents, agent.assignment]
                        : selectedProjectAgents.filter(
                            (id) => id !== agent.assignment,
                          ),
                    })
                  }
                />
              );
            })}
          </div>
        ) : null}
        <Switch
          size="sm"
          label={t("project-settings.label.agent-ask-before-run")}
          checked={settings.ask_before_run}
          onCheckedChange={(checked) =>
            void updateProjectSettings({
              ...settings,
              ask_before_run: checked,
            })
          }
        />
        <Switch
          size="sm"
          label={t("project-settings.label.agent-approve-writes")}
          checked={settings.approve_agent_writes}
          onCheckedChange={(checked) =>
            void updateProjectSettings({
              ...settings,
              approve_agent_writes: checked,
            })
          }
        />
      </div>

      {state.error !== null || actionError !== null ? (
        <p className={styles.error}>
          {actionError ??
            state.error ??
            t("project-settings.error.commands-failed")}
        </p>
      ) : null}

      {/* Detect candidate picker */}
      {detectCandidates !== null ? (
        <div className={styles.card} data-command-detect-results="">
          <h3 className={styles.cardTitle}>
            {t("project-settings.button.detect-commands")}
          </h3>
          {detectNotes.map((note, idx) => (
            <p key={idx} className={styles.note}>
              {note}
            </p>
          ))}
          {detectCandidates.length === 0 ? (
            <p className={styles.note}>
              {t("project-settings.label.detect-empty")}
            </p>
          ) : (
            <div className={styles.detectList}>
              {detectCandidates.map((candidate, index) => (
                <div
                  key={`${candidate.source}:${candidate.name}:${index}`}
                  className={styles.detectItem}
                >
                  <div className={styles.detectTop}>
                    <Checkbox
                      size="sm"
                      label={candidate.name}
                      checked={pickedIndices.has(index)}
                      onCheckedChange={(checked) =>
                        setPickedIndices((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(index);
                          else next.delete(index);
                          return next;
                        })
                      }
                    />
                    <span className={styles.badge}>{candidate.kind}</span>
                    {candidate.already_registered ? (
                      <span className={styles.badge}>
                        {t("project-settings.label.detect-already-added")}
                      </span>
                    ) : null}
                    <span className={styles.detectMeta}>
                      {candidate.source}
                    </span>
                  </div>
                  <pre className={styles.codeBlock}>{candidate.command}</pre>
                </div>
              ))}
            </div>
          )}
          <div className={styles.toolbar}>
            {detectCandidates.length > 0 ? (
              <Button
                size="sm"
                disabled={busy || pickedIndices.size === 0}
                onClick={() => void importDetected()}
              >
                {t("project-settings.button.import-selected")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDetectCandidates(null)}
            >
              {t("project-settings.button.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Empty state vs list */}
      {commands.length === 0 && !adding ? (
        <div className={styles.emptyBox} data-command-empty="">
          <p className={styles.note}>
            {t("project-settings.notice.commands-empty")}
          </p>
          <div className={styles.toolbar}>
            <Button
              size="sm"
              icon={projectCommandActionIcons.detect}
              disabled={detecting || busy}
              onClick={() => void runDetect()}
            >
              {t("project-settings.button.detect-commands")}
            </Button>
            <Button
              size="sm"
              icon={actionIcons.add}
              disabled={busy}
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
            >
              {t("project-settings.button.add-command")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <Button
              size="sm"
              icon={projectCommandActionIcons.detect}
              disabled={detecting || busy}
              onClick={() => void runDetect()}
            >
              {t("project-settings.button.detect-commands")}
            </Button>
            <Button
              size="sm"
              icon={actionIcons.add}
              disabled={busy || commands.length >= PROJECT_COMMANDS_MAX}
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
            >
              {t("project-settings.button.add-command")}
            </Button>
          </div>
          <ul className={styles.rows} data-command-rows="">
            {commands.map((cmd, index) => (
              <li
                key={cmd.id}
                className={styles.item}
                data-command-row={cmd.id}
              >
                <div className={styles.itemHead}>
                  <Icon icon={projectCommandIcon} pixels={16} />
                  <div className={styles.itemInfo}>
                    <div className={styles.itemTitleLine}>
                      <span className={styles.itemName}>{cmd.name}</span>
                      <span className={styles.badge}>{cmd.kind}</span>
                    </div>
                    <span className={styles.codePreview}>{cmd.command}</span>
                  </div>
                  <Tooltip content={t("project-settings.button.move-up")}>
                    <IconButton
                      icon={actionIcons.moveUp}
                      label={t("project-settings.button.move-up")}
                      size="sm"
                      disabled={busy || index === 0}
                      onClick={() => void move(index, -1)}
                    />
                  </Tooltip>
                  <Tooltip content={t("project-settings.button.move-down")}>
                    <IconButton
                      icon={actionIcons.moveDown}
                      label={t("project-settings.button.move-down")}
                      size="sm"
                      disabled={busy || index === commands.length - 1}
                      onClick={() => void move(index, 1)}
                    />
                  </Tooltip>
                  <Tooltip content={t("project-settings.button.edit-command")}>
                    <IconButton
                      icon={actionIcons.edit}
                      label={t("project-settings.button.edit-command")}
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setAdding(false);
                        setEditingId(editingId === cmd.id ? null : cmd.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip
                    content={t("project-settings.button.remove-command")}
                  >
                    <IconButton
                      icon={actionIcons.remove}
                      label={t("project-settings.button.remove-command")}
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setActionError(null);
                        const res = await source.remove(projectId, cmd.id);
                        setBusy(false);
                        if (!res.ok) setActionError(res.error.message);
                        else {
                          if (editingId === cmd.id) setEditingId(null);
                          state.reload();
                        }
                      }}
                    />
                  </Tooltip>
                </div>
                {editingId === cmd.id ? (
                  <CommandForm
                    initial={draftFromCommand(cmd, folders[0]?.ref)}
                    folders={folders}
                    agents={agents}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={async (draft) => {
                      setBusy(true);
                      setActionError(null);
                      const timeoutParsed =
                        draft.kind === "action" &&
                        draft.timeout_ms.trim() !== ""
                          ? Number.parseInt(draft.timeout_ms.trim(), 10)
                          : null;
                      const envRecord = Object.fromEntries(
                        draft.env
                          .map((r) => [r.key.trim(), r.value] as const)
                          .filter(([k]) => k.length > 0),
                      );
                      const res = await source.update(projectId, cmd.id, {
                        name: draft.name.trim(),
                        command: draft.command.trim(),
                        kind: draft.kind,
                        description: draft.description.trim() || null,
                        folder_ref: draft.folder_ref || null,
                        cwd: draft.cwd.trim() || null,
                        env:
                          Object.keys(envRecord).length > 0 ? envRecord : null,
                        preview_url: draft.preview_url.trim() || null,
                        auto_open_preview: draft.auto_open_preview,
                        timeout_ms:
                          timeoutParsed !== null &&
                          Number.isFinite(timeoutParsed) &&
                          timeoutParsed >= 1000
                            ? timeoutParsed
                            : null,
                        agents:
                          draft.agentsMode === "inherit"
                            ? null
                            : draft.agentsMode === "all"
                              ? "all"
                              : [...draft.selectedAgents],
                        ask_before_run:
                          draft.askMode === "inherit"
                            ? null
                            : draft.askMode === "on",
                      });
                      setBusy(false);
                      if (!res.ok) setActionError(res.error.message);
                      else {
                        setEditingId(null);
                        state.reload();
                      }
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {adding ? (
        <CommandForm
          initial={draftFromCommand(undefined, folders[0]?.ref)}
          folders={folders}
          agents={agents}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (draft) => {
            setBusy(true);
            setActionError(null);
            const res = await source.add(projectId, buildInputFromDraft(draft));
            setBusy(false);
            if (!res.ok) setActionError(res.error.message);
            else {
              setAdding(false);
              state.reload();
            }
          }}
        />
      ) : null}
    </div>
  );
}
