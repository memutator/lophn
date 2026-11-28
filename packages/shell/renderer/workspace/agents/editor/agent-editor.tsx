// agent 하나의 설정 화면. 저장된 agent와 새 agent(복제 포함)가 같은 화면을 쓴다.
// 첫 탭 Overview가 정의를 네 묶음(Who · Runs on · Sees · Works how)으로 한 장에 보이고, 묶음마다 탭 하나가 그 칸을 고친다
// (탭마다 파일 하나: tab-*.tsx). 앱 할당은 Sees 탭에 있고 바로 저장된다. 머리의 [Cancel]·[Save]는 어느 탭에서나 보인다.
// source에서 agent를 읽어 form 값을 쥐고, 저장·삭제·이미지 올리기·grant 바꾸기를 source로 보낸다. 저장 실패·충돌 같은 알림은 그 탭 위쪽 toast다.

import type { MessageKey } from "@lophn/i18n";
import { t } from "@lophn/i18n";
import { ErrorState, Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";
import type { CleanUpMode } from "../../../../../protocol/base/follow-ups.ts";
import {
  isLophn,
  workspaceOfLophn,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import { useCommands } from "../../../commands/react.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar, type AvatarLook } from "../../../parts/avatar/avatar.tsx";
import { useOpenHandoffSession } from "../../../shell/cascade-delete-confirm.tsx";
import { codingFaceOf } from "../coding-face.ts";
import type { AgentDraft, AgentsSource, GrantsView } from "../source.ts";
import type { DeployableList } from "../views.ts";
import type { Face } from "../tab-state.ts";
import { useAgentModels } from "../use-agent-models.ts";
import type { McpLogin, McpRow, McpSecret, McpStatus } from "../views.ts";
import styles from "./agent-editor.module.css";
import { copyDefinition, copyHandle } from "./duplicate.ts";
import {
  type EditorTab,
  factsOf,
  GRANT_FIELDS,
  GROUPS,
  isDirty,
  looseIssues,
  type Ready,
  tabOfIssue,
} from "./editor-model.ts";
import { Issues } from "./form-kit.tsx";
import { GrantsPanel } from "./grants-panel.tsx";
import { type AppNames, OverviewTab } from "./tab-overview.tsx";
import { RunsTab } from "./tab-runs.tsx";
import { SeesTab } from "./tab-sees.tsx";
import { WhoTab } from "./tab-who.tsx";
import { WorksTab } from "./tab-works.tsx";

/** editor가 source에서 쓰는 것. */
export type AgentEditorSource = Pick<
  AgentsSource,
  | "readAgent"
  | "newAgent"
  | "saveAgent"
  | "deleteAgent"
  | "uploadImage"
  | "imageSrc"
  | "models"
  | "refreshModels"
  | "setShown"
  | "userModels"
  | "saveModelInfo"
  | "removeModelInfo"
  | "grants"
  | "setGrants"
  | "deployable"
  | "signInMcp"
  | "cancelMcpSignIn"
  | "enterMcpSecret"
  | "readInstructions"
  | "writeInstructions"
  | "readMemory"
  | "writeMemory"
  | "harnessCatalog"
  | "refreshHarnessCatalog"
  | "codingChoices"
>;

interface AgentEditorProps {
  readonly source: AgentEditorSource;
  /** 화면을 연 자리의 열쇠("home", project나 앱 id). null이면 Settings다. */
  readonly workspace: string | null;
  /** 그 곳의 이름. */
  readonly workspaceName: string;
  /** 열 agent를 가리키는 값. 새 agent는 null이다. */
  readonly agent: string | null;
  /** 새 agent를 이 agent의 복제로 연다(agent가 null일 때만). */
  readonly copyOf?: string | null;
  /** 복제 handle이 피할 handle(화면을 연 자리의 목록). 겹치면 저장이 그 칸에 거절을 단다. */
  readonly takenHandles?: readonly string[];
  /** 머리의 [Duplicate]. 저장된 agent에만 있다. */
  readonly onDuplicate?: () => void;
  /** [Cancel]로 editor를 떠난다. */
  readonly onDone: () => void;
  /** 지웠거나 열어 둔 agent가 이미 없어서 editor를 떠난다. 없으면 onDone이다. */
  readonly onGone?: () => void;
  /** 새 agent를 처음 저장했다. 이 editor는 그 agent로 이어진다. */
  readonly onSaved?: (assignment: string) => void;
  /** 탭을 떠났다 돌아온 editor가 이어 받을 저장하지 않은 편집. */
  readonly restore?: Ready | null;
  /** 편집 값이 바뀔 때마다 알린다. 부르는 쪽이 저장하지 않은 편집과 탭 줄의 얼굴을 쥔다. */
  readonly onState?: (state: {
    readonly ready: Ready;
    readonly dirty: boolean;
    readonly face: Face;
  }) => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | Ready;

type GrantsLoaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly view: GrantsView };

interface Notice {
  readonly title: MessageKey;
  readonly body: MessageKey;
}

const TAB_LABEL: Readonly<Record<EditorTab, MessageKey>> = {
  overview: "agents.label.tab-overview",
  who: "agents.label.tab-who",
  runs: "agents.label.tab-runs",
  sees: "agents.label.tab-sees",
  works: "agents.label.tab-works",
};

const TABS: readonly EditorTab[] = ["overview", ...GROUPS];

function EditorLoading(): ReactElement {
  const shown = useDelayedLoading(true);
  return (
    <div className={styles.fill} data-agent-editor="loading">
      {shown ? <Skeleton shape="line" lines={6} /> : null}
    </div>
  );
}

export function AgentEditor(props: AgentEditorProps): ReactElement {
  const { source, workspace, agent } = props;
  const [state, setState] = useState<Loaded>(
    props.restore ?? { kind: "loading" },
  );
  const models = useAgentModels(source);
  const openHandoff = useOpenHandoffSession();
  const [tab, setTab] = useState<EditorTab>("overview");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [grants, setGrants] = useState<GrantsLoaded>({ kind: "loading" });
  // 배포할 수 있는 앱 skill. 읽는 중이거나 읽지 못했으면 null이다.
  const [deployable, setDeployable] = useState<DeployableList | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [grantsAttempt, setGrantsAttempt] = useState(0);
  // 저장은 한 줄로 이어 보낸다. 앞 저장이 끝나기 전에 다음 변화를 보내면 옛 revision이라 conflict가 난다.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  // 이 화면이 시작해 아직 callback을 기다리는 MCP 로그인이다.
  const [signingIn, setSigningIn] = useState<readonly string[]>([]);
  // 탭을 떠났다 돌아왔으면 읽지 않고 그 편집에서 이어 간다. 한 번만 쓴다.
  const restored = useRef(props.restore ?? null);

  useEffect(() => {
    if (restored.current !== null) {
      restored.current = null;
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    const copyOf = agent === null ? (props.copyOf ?? null) : null;
    if (copyOf !== null) {
      void openCopy(copyOf).then((ready) => {
        if (!live) return;
        if (ready === null) setState({ kind: "failed" });
        else setState(ready);
      });
      return () => {
        live = false;
      };
    }
    const opened =
      agent === null
        ? source.newAgent(workspace)
        : source.readAgent(workspace, agent);
    void opened.then((result) => {
      if (!live) return;
      if (!result.ok) {
        // 열어 둔 agent가 이미 없으면 목록으로 돌아간다.
        if (agent !== null && result.message === "not_found") {
          (props.onGone ?? props.onDone)();
        } else setState({ kind: "failed" });
        return;
      }
      setState({
        kind: "ready",
        detail: result.value,
        base: result.value.definition,
        definition: result.value.definition,
        issues: result.value.issues,
      });
    });
    return () => {
      live = false;
    };
    // props.onDone은 부르는 쪽이 만드는 함수라 바뀔 때마다 다시 읽지 않는다.
  }, [source, workspace, agent, attempt]);

  // 복제: 새 agent의 빈 값(미리 받은 id, 그 자리의 층)에 원래 agent의 저장된 정의를 옮긴다. 저장 전이라 base도 같은 값이다.
  async function openCopy(from: string): Promise<Ready | null> {
    const [fresh, original] = await Promise.all([
      source.newAgent(workspace),
      source.readAgent(workspace, from),
    ]);
    if (!fresh.ok || !original.ok) return null;
    const read = original.value;
    const name = read.definition.name ?? read.effective.name.value;
    const handle =
      read.card?.handle ??
      read.definition.handle ??
      (isLophn(from) ? "lophn" : name);
    const copied = copyDefinition(
      {
        definition: read.definition,
        id: from,
        scope: isLophn(from)
          ? workspaceOfLophn(from)
          : (read.definition.workspace ?? null),
        runtime: read.card?.runtime,
      },
      {
        name: t("agents.label.copy-name", { name }),
        handle: copyHandle(handle, props.takenHandles ?? []),
        id: fresh.value.draftId ?? "",
      },
    );
    return {
      kind: "ready",
      detail: fresh.value,
      base: copied.definition,
      definition: copied.definition,
      issues: [],
      copyOf: { name, imageDropped: copied.imageDropped },
    };
  }

  // 할당은 Overview와 Sees가 보인다. 저장된 agent를 열 때 읽는다(새 agent는 만들기 전에는 붙일 수 없다).
  useEffect(() => {
    if (agent === null) return;
    let live = true;
    setGrants({ kind: "loading" });
    void source.grants(workspace, agent).then((result) => {
      if (live) {
        if (result.ok) revision.current = result.value.revision;
        setGrants(
          result.ok
            ? { kind: "ready", view: result.value }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      live = false;
    };
  }, [source, workspace, agent, attempt, grantsAttempt]);

  useEffect(() => {
    let live = true;
    void source.deployable().then((result) => {
      if (live) setDeployable(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [source, attempt]);

  const ready = state.kind === "ready" ? state : null;
  const dirty = ready !== null && isDirty(ready);
  const lastReport = useRef(props.onState);
  lastReport.current = props.onState;
  const shownName =
    ready === null
      ? ""
      : (ready.definition.name ?? ready.detail.effective.name.value);
  const shownAvatar: AvatarLook | null = (() => {
    if (ready === null) return null;
    const avatar =
      ready.definition.avatar ?? ready.detail.effective.avatar.value;
    const runtime =
      ready.definition.runtime ?? ready.detail.definition?.runtime;
    const coding =
      ready.detail.assignment === null
        ? undefined
        : avatar.kind === "character"
          ? codingFaceOf(ready.detail.assignment, runtime)
          : codingFaceOf(ready.detail.assignment);
    if (coding !== undefined) return coding;
    return avatar.kind === "character"
      ? avatar
      : {
          kind: "image",
          src:
            ready.detail.assignment === null
              ? ""
              : source.imageSrc(
                  workspace,
                  ready.detail.assignment,
                  avatar.image,
                ),
        };
  })();
  // 탭 줄이 이 agent의 이름과 아이콘을 보이도록 알린다(새 agent는 이름이 없어 제목 글이다).
  useEffect(() => {
    if (ready === null || shownAvatar === null) return;
    lastReport.current?.({
      ready,
      dirty,
      face: {
        name:
          ready.detail.assignment === null && shownName.trim() === ""
            ? t("project-workspace.heading.agents-new-agent")
            : shownName,
        avatar: shownAvatar,
      },
    });
    // shownAvatar는 매번 새로 만들어서 값으로 비교한다.
  }, [ready, dirty, shownName, JSON.stringify(shownAvatar)]);

  const save = () => {
    if (ready === null) return;
    const { detail, definition } = ready;
    void source
      .saveAgent(workspace, {
        assignment: detail.assignment,
        draftId: detail.draftId,
        definition,
        hash: detail.hash,
      })
      .then((result) => {
        if (result.ok) {
          setNotice(null);
          // 새 agent는 id가 생겼으니 그 agent로 이어진다. 저장된 agent는 파일을 다시 읽어 hash와 명함을 맞춘다.
          if (detail.assignment === null)
            props.onSaved?.(result.value.assignment);
          else setAttempt((count) => count + 1);
          return;
        }
        setState((current) =>
          current.kind === "ready"
            ? { ...current, issues: result.issues }
            : current,
        );
        setNotice(
          result.issues.length > 0
            ? null
            : result.message === "conflict"
              ? {
                  title: "agents.title.save-conflict",
                  body: "project-workspace.notice.agents-save-conflict",
                }
              : {
                  title: "agents.title.save-failed",
                  body: "project-workspace.notice.agents-save-failed",
                },
        );
      });
  };

  // Ctrl+S(Mac은 Cmd+S). 편집 값이 있을 때만 받는다.
  useCommands({ "agents.save": save }, { when: () => dirty });

  if (state.kind === "loading") return <EditorLoading />;
  if (state.kind === "failed") {
    return (
      <div className={styles.fill} data-agent-editor="failed">
        <ErrorState
          target={t("project-workspace.label.agents-target")}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      </div>
    );
  }

  const { detail, definition } = state;
  const facts = factsOf(detail, definition);
  const { fresh, lophn } = facts;
  const edit = (next: AgentDraft) =>
    setState((current) =>
      current.kind === "ready" ? { ...current, definition: next } : current,
    );
  const name = shownName;

  const remove = (cleanUp: CleanUpMode) => {
    if (detail.assignment === null || detail.hash === null) return;
    void source
      .deleteAgent(workspace ?? "", detail.assignment, detail.hash, cleanUp)
      .then((result) => {
        if (!result.ok) {
          setNotice({
            title: "agents.title.delete-failed",
            body: "project-workspace.notice.agents-delete-failed",
          });
          return;
        }
        (props.onGone ?? props.onDone)();
        openHandoff(result.value?.handoff_session);
      });
  };

  // 로그인 뒤에는 그 줄의 상태만 바꾼다: 저장하지 않은 정의 편집을 다시 읽어 잃지 않는다.
  const patchLogin = (
    name: string,
    login: Pick<McpLogin, "state">,
    status: McpStatus,
  ) =>
    setState((current) => {
      if (current.kind !== "ready") return current;
      const own = current.detail.agentMcpLogins[name];
      return {
        ...current,
        detail: {
          ...current.detail,
          mcpServers: current.detail.mcpServers.map((row) =>
            row.name === name && row.login !== undefined
              ? {
                  ...row,
                  status,
                  login: { ...row.login, state: login.state, reason: null },
                }
              : row,
          ),
          // 정의 층 줄은 detail의 로그인 기록에서 그린다. 저장하지 않은 편집은 건드리지 않는다.
          agentMcpLogins:
            own === undefined
              ? current.detail.agentMcpLogins
              : {
                  ...current.detail.agentMcpLogins,
                  [name]: { ...own, state: login.state, reason: null },
                },
        },
      };
    });

  const signIn = (row: McpRow) => {
    const login = row.login;
    if (login === undefined || signingIn.includes(row.name)) return;
    setSigningIn((was) => [...was, row.name]);
    void source.signInMcp(row.name, login).then((result) => {
      setSigningIn((was) => was.filter((one) => one !== row.name));
      if (!result.ok) {
        setNotice({
          title: "agents.title.sign-in-failed",
          body: "agents.error.mcp-sign-in-failed",
        });
      }
      patchLogin(
        row.name,
        { state: result.ok ? "signed_in" : "none" },
        result.ok ? "connected" : "needs-sign-in",
      );
    });
  };

  const cancelSignIn = (row: McpRow) => {
    void source
      .cancelMcpSignIn(row.name, {
        workspace: row.login?.workspace ?? null,
        agent: row.login?.agent ?? null,
      })
      .then(() => {
        setSigningIn((was) => was.filter((one) => one !== row.name));
        patchLogin(row.name, { state: "none" }, "needs-sign-in");
      });
  };

  const setSecret = (row: McpRow, secret: McpSecret) => {
    void source.enterMcpSecret(secret.name, row.name);
  };

  const upload = (file: File) => {
    if (detail.assignment === null) return;
    void source
      .uploadImage(workspace, detail.assignment, file)
      .then((result) => {
        if (!result.ok) {
          setNotice({
            title: "agents.title.upload-failed",
            body: "project-workspace.notice.agents-upload-failed",
          });
          return;
        }
        setNotice(null);
        edit({
          ...definition,
          avatar: { kind: "image", image: result.value.image },
        });
      });
  };

  // 다른 컴퓨터 앱 할당은 정의 파일의 remote_apps라 할당 저장이 파일 hash를 바꾼다. 들고 있는 hash와 그 칸들을 파일에 맞춰,
  // 이어지는 정의 저장이 conflict가 되거나 방금 바꾼 할당을 옛 값으로 덮지 않게 한다. 편집 중인 다른 칸은 그대로 둔다.
  const syncGrantsFile = async (assignment: string) => {
    const read = await source.readAgent(workspace, assignment);
    if (!read.ok) return;
    const stored = read.value.definition as unknown as Record<string, unknown>;
    const merge = (draft: AgentDraft) => {
      const next: Record<string, unknown> = { ...draft };
      for (const field of GRANT_FIELDS) {
        if (stored[field] === undefined) delete next[field];
        else next[field] = stored[field];
      }
      return next as unknown as AgentDraft;
    };
    setState((current) => {
      if (current.kind !== "ready") return current;
      return {
        ...current,
        detail: { ...current.detail, hash: read.value.hash },
        base: merge(current.base),
        definition: merge(current.definition),
      };
    });
  };

  // Grants의 변화는 바로 저장한다. 저장하지 못하면(다른 창이 먼저 고쳐 conflict인 때도) 다시 읽어 맞춘다.
  const changeGrants = (entries: readonly AssignmentEntry[]) => {
    if (grants.kind !== "ready" || detail.assignment === null) return;
    const assignment = detail.assignment;
    const before = grants.view;
    setGrants({ kind: "ready", view: { ...before, entries } });
    saving.current = saving.current.then(async () => {
      const result = await source.setGrants(
        workspace,
        assignment,
        entries,
        revision.current,
      );
      if (result.ok) {
        revision.current = result.value.revision;
        await syncGrantsFile(assignment);
        return;
      }
      const fresh = await source.grants(workspace, assignment);
      if (fresh.ok) revision.current = fresh.value.revision;
      setGrants(
        fresh.ok
          ? { kind: "ready", view: fresh.value }
          : {
              kind: "ready",
              view: before,
            },
      );
      setNotice({
        title: "agents.title.change-failed",
        body: "project-workspace.notice.agents-change-failed",
      });
    });
  };

  const form = {
    detail,
    definition,
    issues: state.issues,
    workspaceName: props.workspaceName,
    onChange: edit,
  };
  const marked = new Set<EditorTab>(state.issues.map(tabOfIssue));
  const imageSrc = (image: string) =>
    detail.assignment === null
      ? ""
      : source.imageSrc(workspace, detail.assignment, image);
  // Overview의 다른 컴퓨터 앱 줄: 저장된 이름이다.
  const appNames: AppNames =
    detail.assignment === null || grants.kind === "loading"
      ? { state: detail.assignment === null ? "none" : "loading" }
      : grants.kind === "failed"
        ? { state: "failed" }
        : {
            state: "ready",
            remote: grants.view.entries.map((entry) => entry.name),
          };
  const copiedApps =
    (definition as { remote_apps?: readonly unknown[] }).remote_apps?.length ??
    0;
  const apps = fresh ? (
    <p className={styles.note}>
      {copiedApps === 0
        ? t("agents.notice.grants-after-create")
        : t("agents.notice.copy-apps", { count: copiedApps })}
    </p>
  ) : grants.kind === "loading" ? (
    <EditorLoading />
  ) : grants.kind === "failed" ? (
    <ErrorState
      target={t("agents.label.grants-target")}
      onRetry={() => setGrantsAttempt((count) => count + 1)}
    />
  ) : (
    <>
      <GrantsPanel entries={grants.view.entries} onChange={changeGrants} />
      <p className={styles.note}>{t("agents.notice.grants-apply-now")}</p>
    </>
  );

  return (
    <div className={styles.page} data-agent-editor="ready">
      {notice === null ? null : (
        <div className={styles.toastSlot}>
          <Toast
            tone="error"
            title={t(notice.title)}
            body={t(notice.body)}
            onClose={() => setNotice(null)}
          />
        </div>
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(value as EditorTab)}>
        <div className={styles.head}>
          <div className={styles.headRow}>
            <h1 className={styles.title}>
              {shownAvatar === null ? null : (
                <Avatar look={shownAvatar} size="md" />
              )}
              <span className={styles.titleText}>
                {fresh && name.trim() === ""
                  ? t("project-workspace.heading.agents-new-agent")
                  : name}
              </span>
              {lophn ? (
                <span className={styles.chip}>
                  {t("agents.label.built-in")}
                </span>
              ) : null}
            </h1>
            <div className={styles.formActions}>
              {fresh || props.onDuplicate === undefined ? null : (
                <Button
                  icon={actionIcons.duplicate}
                  onClick={props.onDuplicate}
                  data-action="duplicate"
                >
                  {t("agents.button.duplicate")}
                </Button>
              )}
              <Button onClick={props.onDone}>
                {t("common.button.cancel")}
              </Button>
              <Button
                variant="primary"
                icon={fresh ? actionIcons.create : actionIcons.save}
                onClick={save}
              >
                {fresh
                  ? t("agents.button.create-agent")
                  : t("project-workspace.button.agent-editor-save")}
              </Button>
            </div>
          </div>
          <Issues issues={looseIssues(state.issues)} />
          <TabList>
            {TABS.map((one) => (
              <Tab key={one} size="sm" value={one}>
                {t(TAB_LABEL[one])}
                {marked.has(one) && one !== tab ? (
                  <span
                    className={styles.tabMark}
                    role="img"
                    aria-label={t("agents.label.tab-has-issues")}
                  />
                ) : null}
              </Tab>
            ))}
          </TabList>
        </div>
        <TabPanel value="overview">
          <OverviewTab
            {...form}
            facts={facts}
            face={shownAvatar}
            name={name}
            models={models}
            apps={appNames}
            deployable={deployable}
            copyOf={state.copyOf}
            onEdit={setTab}
          />
        </TabPanel>
        <TabPanel value="who">
          <WhoTab
            {...form}
            facts={facts}
            copyOf={state.copyOf}
            imageSrc={imageSrc}
            onUpload={upload}
            onDelete={remove}
          />
        </TabPanel>
        <TabPanel value="runs">
          <RunsTab
            {...form}
            facts={facts}
            models={models}
            workspace={workspace}
            source={source}
          />
        </TabPanel>
        <TabPanel value="sees">
          <SeesTab
            {...form}
            facts={facts}
            apps={apps}
            deployable={deployable}
            onSignIn={signIn}
            onCancelSignIn={cancelSignIn}
            onSetSecret={setSecret}
            signingIn={signingIn}
          />
        </TabPanel>
        <TabPanel value="works">
          <WorksTab
            {...form}
            facts={facts}
            workspaceInstructions={{
              read: () => source.readInstructions(workspace ?? ""),
              write: (text, hash) =>
                source.writeInstructions(workspace ?? "", text, hash),
            }}
            memoryPort={{
              read: () =>
                source.readMemory({
                  kind: "agent",
                  agent: detail.assignment ?? "",
                }),
              write: (text, hash) =>
                source.writeMemory(
                  { kind: "agent", agent: detail.assignment ?? "" },
                  text,
                  hash,
                ),
            }}
          />
        </TabPanel>
      </Tabs>
    </div>
  );
}
