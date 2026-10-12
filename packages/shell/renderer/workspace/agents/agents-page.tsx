// Agents 탭의 본문 전체. 목록(AgentsTab)과 같은 탭 안에서 여는 editor(AgentEditor)를
// source에 잇는다. 화면 component는 값을 props로 받아 그리기만 하므로 읽기·저장·거절 표시·model picker 상태는 여기서
// 쥔다. 열어 둔 agent는 탭의 필드(layout)에 남고, 첫 저장 전의 새 Operator는 이 탭 안의 상태일 뿐이다.
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";
import type { MessageKey } from "@lophn/wording";

import type {
  AgentDefinition,
  AgentIssue,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type { AgentRole } from "../../../../protocol/lophn-agent/scope.ts";
import {
  AVATAR_ICON_IDS,
  type AvatarIconId,
} from "../../../../design/components/avatar/avatar-icons.ts";
import { AgentsTab, type RoleModelRow } from "./agents-tab.tsx";
import {
  AgentEditor,
  type AvatarIconOption,
  type ContextOption,
  type PermissionChoice,
} from "./editor/agent-editor.tsx";
import {
  CLOSED_PICKER,
  modelLabelOf,
  pickerProps,
  type PickerState,
} from "./model-picker-data.ts";
import styles from "./agents-page.module.css";
import type {
  AgentDetail,
  AgentsOverview,
  AgentsSource,
  ModelsView,
} from "./source.ts";
import type { PermissionRow } from "./views.ts";

const ROLES: readonly AgentRole[] = [
  "lophn",
  "context_engineer",
  "app_engineer",
  "operator",
];

const ICON_LABEL: Record<AvatarIconId, MessageKey> = {
  dock: "project-workspace.label.avatar-icon-dock",
  roles: "project-workspace.label.avatar-icon-roles",
  contexts: "project-workspace.label.avatar-icon-contexts",
  documents: "project-workspace.label.avatar-icon-documents",
  apps: "project-workspace.label.avatar-icon-apps",
  search: "project-workspace.label.avatar-icon-search",
  series: "project-workspace.label.avatar-icon-series",
  bookmark: "project-workspace.label.avatar-icon-bookmark",
  terminal: "project-workspace.label.avatar-icon-terminal",
  read: "project-workspace.label.avatar-icon-read",
  edit: "project-workspace.label.avatar-icon-edit",
  compare: "project-workspace.label.avatar-icon-compare",
};

export interface AgentsPageProps {
  project: string;
  projectName: string;
  source: AgentsSource;
  /** 탭이 열어 둔 agent의 assignment. 없으면 목록이다. */
  agent: string | null;
  /** 열어 둔 agent를 바꾼다(탭 필드). null이면 목록으로 돌아간다. */
  onAgent: (assignment: string | null) => void;
  /** Operator에 붙일 수 있는 이 project의 context. */
  contexts: readonly ContextOption[];
  /** project의 LOPHN.md를 연다. 통로가 없으면 단추는 아무것도 하지 않는다. */
  onEditInstructions: () => void;
  /** Settings › Agents로 간다(model picker의 Change defaults…). */
  onChangeDefaults: () => void;
  /** Skills·MCP servers의 [Add …]. 등록 form은 lophn 공간이 갖고 있다. */
  onAddExtension: () => void;
  /** 목록이나 정의가 바뀌었다. sidebar의 Agents 묶음이 다시 읽는다. */
  onChanged: () => void;
}

type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

/** editor가 쥔 form. detail은 읽은 값, definition은 지금 고치는 값이다. */
interface Form {
  readonly detail: AgentDetail;
  readonly definition: AgentDefinition;
  readonly issues: readonly AgentIssue[];
}

function without<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

function withTools(
  definition: AgentDefinition,
  tools: readonly string[],
): AgentDefinition {
  return { ...definition, permissions: { tools: [...tools] } };
}

export function AgentsPage(props: AgentsPageProps): ReactElement {
  const { project, source, agent } = props;
  const [overview, setOverview] = useState<Loaded<AgentsOverview>>({
    kind: "loading",
  });
  const [models, setModels] = useState<ModelsView | null>(null);
  const [reloads, setReloads] = useState(0);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [pickers, setPickers] = useState<Readonly<Record<string, PickerState>>>(
    {},
  );
  // 첫 저장 전의 새 Operator editor. 열어 둔 agent가 있으면 그쪽이 먼저다.
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Loaded<Form>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // 권한 규칙은 켜진 것만 읽혀서 끈 동작이 줄에서 사라지지 않게 본 적 있는 동작을 이 탭이 기억한다.
  const [knownTools, setKnownTools] = useState<readonly string[]>([]);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    void source.overview(project).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setOverview({ kind: "failed" });
        return;
      }
      setOverview({ kind: "ready", value: result.value });
      setKnownTools((known) => [
        ...known,
        ...result.value.permissions.map((rule) => rule.tool).filter((tool) =>
          !known.includes(tool)
        ),
      ]);
    });
    return () => {
      live = false;
    };
  }, [source, project, reloads]);

  useEffect(() => {
    let live = true;
    void source.models().then((result) => {
      if (live) setModels(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [source]);

  const editing = agent !== null || creating;
  useEffect(() => {
    if (!editing) return;
    let live = true;
    setForm({ kind: "loading" });
    const opened = agent === null
      ? source.newOperator(project)
      : source.readAgent(project, agent);
    void opened.then((result) => {
      if (!live) return;
      if (!result.ok) {
        // 열어 둔 agent가 이미 없으면 목록으로 돌아간다.
        if (agent !== null && result.message === "not_found") {
          props.onAgent(null);
        } else setForm({ kind: "failed" });
        return;
      }
      setForm({
        kind: "ready",
        value: {
          detail: result.value,
          definition: result.value.definition,
          issues: result.value.issues,
        },
      });
    });
    return () => {
      live = false;
    };
    // props.onAgent는 탭이 만드는 함수라 바뀔 때마다 다시 읽지 않는다.
  }, [source, project, agent, creating, editing, attempt]);

  const pickerState = (key: string) => pickers[key] ?? CLOSED_PICKER;
  const setPicker = (key: string) => (state: PickerState) =>
    setPickers((current) => ({ ...current, [key]: state }));
  const modelLabel = modelLabelOf(models);

  // 설정을 바꾸는 명령 하나. 성공하면 다시 읽고 실패하면 바뀌지 않았다고 알린다.
  const change = (run: () => Promise<{ ok: boolean }>) => {
    void run().then((result) => {
      setNotice(
        result.ok ? null : "project-workspace.notice.agents-change-failed",
      );
      reload();
    });
  };

  const leave = () => {
    setCreating(false);
    props.onAgent(null);
  };

  const pickerBinding = (
    key: string,
    current: ModelChoice | null,
    choose: (choice: ModelChoice) => void,
  ) =>
    pickerProps({
      models,
      state: pickerState(key),
      setState: setPicker(key),
      current,
      choose,
      setFavorites: (items) =>
        void source.setFavorites(items).then((result) => {
          if (result.ok) {
            setModels((view) =>
              view === null ? view : { ...view, favorites: result.value }
            );
          }
        }),
      changeDefaults: props.onChangeDefaults,
    });

  if (editing) {
    if (
      form.kind === "loading" ||
      (form.kind === "ready" && overview.kind === "loading")
    ) {
      return (
        <div className={styles.fill} data-agents-page="loading">
          <Skeleton shape="line" lines={6} />
        </div>
      );
    }
    if (form.kind === "failed" || overview.kind !== "ready") {
      return (
        <div className={styles.fill} data-agents-page="failed">
          <ErrorState
            target={t("project-workspace.label.agents-target")}
            onRetry={() => {
              setForm({ kind: "loading" });
              setOverview({ kind: "loading" });
              setAttempt((count) => count + 1);
              reload();
            }}
          />
        </div>
      );
    }
    return (
      <EditorView
        {...props}
        overview={overview.value}
        models={models}
        form={form.value}
        update={(change) =>
          setForm((current) =>
            current.kind === "ready"
              ? { kind: "ready", value: change(current.value) }
              : current
          )}
        notice={notice}
        setNotice={setNotice}
        leave={leave}
        reload={reload}
        knownTools={knownTools}
        modelLabel={modelLabel}
        picker={pickerBinding}
      />
    );
  }

  if (overview.kind === "loading") {
    return (
      <div className={styles.fill} data-agents-page="loading">
        <Skeleton shape="line" lines={6} />
      </div>
    );
  }
  if (overview.kind === "failed") {
    return (
      <div className={styles.fill} data-agents-page="failed">
        <ErrorState
          target={t("project-workspace.label.agents-target")}
          onRetry={() => {
            setOverview({ kind: "loading" });
            reload();
          }}
        />
      </div>
    );
  }

  const data = overview.value;
  const modelRoles: RoleModelRow[] = ROLES.map((role) => {
    const chosen = data.chosenModels[role] ?? null;
    const effective = data.effectiveModels[role] ?? null;
    return {
      role,
      chosen,
      effective,
      picker: pickerBinding(
        `role:${role}`,
        chosen ?? effective?.value ?? null,
        (choice) => change(() => source.changeRoleModel(project, role, choice)),
      ),
    };
  });
  const permissions: PermissionRow[] = [
    ...knownTools,
    ...data.permissions.map((rule) => rule.tool).filter((tool) =>
      !knownTools.includes(tool)
    ),
  ].map((tool) => ({
    tool,
    label: tool,
    on: data.permissions.some((rule) => rule.tool === tool && rule.on),
  }));
  return (
    <>
      {notice === null
        ? null
        : <p className={styles.notice} role="alert">{t(notice)}</p>}
      <AgentsTab
        projectName={props.projectName}
        agents={data.agents}
        imageSrc={(assignment, image) =>
          source.imageSrc(project, assignment, image)}
        instructions={data.instructions}
        modelRoles={modelRoles}
        modelLabel={modelLabel}
        skills={data.skills}
        mcpServers={data.mcpServers}
        permissions={permissions}
        onOpenAgent={(assignment) => props.onAgent(assignment)}
        onNewOperator={() => setCreating(true)}
        onEditInstructions={props.onEditInstructions}
        onResetRoleModel={(role) =>
          change(() => source.changeRoleModel(project, role, null))}
        onToggleSkill={(name, on) =>
          change(() => source.setSkill(project, name, on))}
        onAddSkill={props.onAddExtension}
        onToggleMcp={(name, on) =>
          change(() => source.setMcp(project, name, on))}
        onAddServer={props.onAddExtension}
        onChangePermission={(tool, on) =>
          change(() => source.setPermission(project, tool, on))}
      />
    </>
  );
}

interface EditorViewProps extends AgentsPageProps {
  overview: AgentsOverview;
  models: ModelsView | null;
  form: Form;
  /** form을 지금 값에서 바꾼다. 읽기 응답을 기다리는 사이 고친 값이 사라지지 않게 함수로 받는다. */
  update: (change: (form: Form) => Form) => void;
  notice: MessageKey | null;
  setNotice: (notice: MessageKey | null) => void;
  leave: () => void;
  reload: () => void;
  knownTools: readonly string[];
  modelLabel: ReturnType<typeof modelLabelOf>;
  picker: (
    key: string,
    current: ModelChoice | null,
    choose: (choice: ModelChoice) => void,
  ) => ReturnType<typeof pickerProps>;
}

function EditorView(props: EditorViewProps): ReactElement {
  const { project, source, overview, form, setNotice } = props;
  const { detail, definition } = form;
  const edit = (next: AgentDefinition) =>
    props.update((current) => ({ ...current, definition: next }));

  const toolsNow =
    (definition.permissions ?? detail.effective.permissions.value)
      .tools;
  const ceiling = overview.permissions.filter((rule) => rule.on).map((rule) =>
    rule.tool
  );
  // 이 project가 권한 규칙을 정하지 않았으면 아는 동작 모두를 고를 수 있다.
  const known = [
    ...new Set([...ceiling, ...props.knownTools, ...toolsNow]),
  ];
  const permissionChoices: PermissionChoice[] = known.map((tool) => ({
    tool,
    label: tool,
    projectAllows: ceiling.length === 0 || ceiling.includes(tool),
  }));

  const currentModel = definition.model ?? detail.effective.model?.value ??
    null;

  const save = () => {
    void source.saveAgent(project, {
      assignment: detail.assignment,
      definition,
      hash: detail.hash,
    }).then((result) => {
      if (result.ok) {
        setNotice(null);
        props.onChanged();
        props.reload();
        props.leave();
        return;
      }
      props.update((current) => ({ ...current, issues: result.issues }));
      setNotice(
        result.issues.length > 0
          ? null
          : result.message === "conflict"
          ? "project-workspace.notice.agents-save-conflict"
          : "project-workspace.notice.agents-save-failed",
      );
    });
  };

  const remove = () => {
    if (detail.assignment === null || detail.hash === null) return;
    void source.deleteAgent(project, detail.assignment, detail.hash).then(
      (result) => {
        if (!result.ok) {
          setNotice("project-workspace.notice.agents-delete-failed");
          return;
        }
        setNotice(null);
        props.onChanged();
        props.reload();
        props.leave();
      },
    );
  };

  const upload = (file: File) => {
    if (detail.assignment === null) return;
    void source.uploadImage(project, detail.assignment, file).then((result) => {
      if (!result.ok) {
        setNotice("project-workspace.notice.agents-upload-failed");
        return;
      }
      setNotice(null);
      props.update((current) => ({
        ...current,
        definition: {
          ...current.definition,
          profile: { kind: "image", image: result.value.image },
        },
      }));
    });
  };

  const skillsOff = definition.skills_off ?? [];
  const mcpOff = definition.mcp_off ?? [];
  const title = detail.assignment === null
    ? t("project-workspace.heading.agents-new-operator")
    : definition.name ?? detail.effective.name.value;
  return (
    <div className={styles.page} data-agents-page="editor">
      <h1 className={styles.title}>{title}</h1>
      {props.notice === null
        ? null
        : <p className={styles.notice} role="alert">{t(props.notice)}</p>}
      <AgentEditor
        agent={{
          assignment: detail.assignment,
          role: detail.role,
          kind: detail.kind,
        }}
        projectName={props.projectName}
        definition={definition}
        effective={detail.effective}
        issues={form.issues}
        imageSrc={(image) =>
          detail.assignment === null
            ? ""
            : source.imageSrc(project, detail.assignment, image)}
        avatarIcons={AVATAR_ICON_IDS.map((id): AvatarIconOption => ({
          id,
          label: t(ICON_LABEL[id]),
        }))}
        projectInstructions={overview.instructions}
        builtInInstructions={null}
        modelLabel={props.modelLabel}
        picker={props.picker("editor", currentModel, (choice) =>
          edit({ ...definition, model: choice }))}
        projectContexts={props.contexts}
        skills={overview.skills.map((skill) =>
          skill.name
        )}
        mcpServers={overview.mcpServers.map((server) => server.name)}
        permissionChoices={permissionChoices}
        onName={(name) => edit({ ...definition, name })}
        onPickIcon={(icon) =>
          edit({ ...definition, profile: { kind: "icon", icon } })}
        onUploadImage={upload}
        onInstructions={(body) => edit({ ...definition, body })}
        onEditProjectInstructions={props.onEditInstructions}
        onResetModel={() => edit(without(definition, "model"))}
        onAddContext={(id) =>
          edit({
            ...definition,
            contexts: [...(definition.contexts ?? []), id],
          })}
        onRemoveContext={(id) =>
          edit({
            ...definition,
            contexts: (definition.contexts ?? []).filter((each) => each !== id),
          })}
        onToggleSkill={(name, on) => {
          const next = on
            ? skillsOff.filter((each) => each !== name)
            : [...skillsOff.filter((each) => each !== name), name];
          edit(
            next.length === 0
              ? without(definition, "skills_off")
              : { ...definition, skills_off: next },
          );
        }}
        onToggleMcp={(name, on) => {
          // 서버 전체를 끈 항목만 이 스위치의 몫이고 tool 하나만 끈 항목은 그대로 둔다.
          const rest = mcpOff.filter((entry) =>
            !(entry.server_name === name && entry.original_tool === undefined)
          );
          const next = on ? rest : [...rest, { server_name: name }];
          edit(
            next.length === 0
              ? without(definition, "mcp_off")
              : { ...definition, mcp_off: next },
          );
        }}
        onTogglePermission={(tool, on) =>
          edit(withTools(
            definition,
            on
              ? (toolsNow.includes(tool) ? toolsNow : [...toolsNow, tool])
              : toolsNow.filter((each) => each !== tool),
          ))}
        onSave={save}
        onCancel={props.leave}
        onDelete={remove}
      />
    </div>
  );
}
