// agent 하나의 설정 화면. 저장된 agent와 새 agent가 같은 화면을 쓴다.
// General · Runtime · Instructions · Skills · Memory · Tools 탭이 정의를 고치고(탭마다 파일 하나: tab-*.tsx) Grants 탭에서
// 맡길 것을 붙인다. 머리의 [Cancel]·[Save]는 어느 탭에서나 보인다. source에서 agent를 읽어 form 값을 쥐고, 저장·삭제·이미지
// 올리기·grant 바꾸기를 source로 보낸다. 저장 실패·충돌 같은 알림은 그 탭 위쪽 toast다.

import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import type { MessageKey } from "@lophn/i18n";
import { t } from "@lophn/i18n";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";

import { actionIcons } from "../../../icons/mod.ts";
import { useCommands } from "../../../commands/react.tsx";
import { Avatar, type AvatarProfile } from "../../../parts/avatar/avatar.tsx";
import type { Face } from "../tab-state.ts";
import type {
  AgentDraft,
  AgentsSource,
  GrantsView,
  ModelsView,
} from "../source.ts";
import type { McpLogin, McpRow, McpStatus } from "../views.ts";
import {
  type EditorTab,
  factsOf,
  isDirty,
  looseIssues,
  type Ready,
  tabOfIssue,
  visibleTabs,
} from "./editor-model.ts";
import { Issues } from "./form-kit.tsx";
import { GrantsPanel } from "./grants-panel.tsx";
import { GeneralTab } from "./tab-general.tsx";
import { InstructionsTab } from "./tab-instructions.tsx";
import { MemoryTab } from "./tab-memory.tsx";
import { RuntimeTab } from "./tab-runtime.tsx";
import { SkillsTab } from "./tab-skills.tsx";
import { ToolsTab } from "./tab-tools.tsx";
import styles from "./agent-editor.module.css";

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
  | "signInMcp"
  | "cancelMcpSignIn"
  | "readInstructions"
  | "writeInstructions"
  | "readMemory"
  | "writeMemory"
>;

interface AgentEditorProps {
  readonly source: AgentEditorSource;
  /** 화면을 연 자리의 열쇠("home", project나 앱 id). null이면 Settings다. */
  readonly workspace: string | null;
  /** 그 곳의 이름. */
  readonly workspaceName: string;
  /** 열 agent를 가리키는 값. 새 agent는 null이다. */
  readonly agent: string | null;
  /** [Cancel]로 editor를 떠난다. */
  readonly onDone: () => void;
  /** 지웠거나 열어 둔 agent가 이미 없어서 editor를 떠난다. 없으면 onDone이다. */
  readonly onGone?: () => void;
  /** 새 agent를 처음 저장했다. 이 editor는 그 agent로 이어진다. */
  readonly onSaved?: (assignment: string) => void;
  /** 목록이나 정의가 바뀌었다. */
  readonly onChanged: () => void;
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
  general: "agents.label.tab-general",
  runtime: "agents.label.tab-runtime",
  instructions: "agents.label.tab-instructions",
  skills: "agents.label.tab-skills",
  memory: "agents.label.tab-memory",
  tools: "agents.label.tab-tools",
  grants: "agents.label.tab-grants",
};

function Loading(): ReactElement {
  return (
    <div className={styles.fill} data-agent-editor="loading">
      <Skeleton shape="line" lines={6} />
    </div>
  );
}

export function AgentEditor(props: AgentEditorProps): ReactElement {
  const { source, workspace, agent } = props;
  const [state, setState] = useState<Loaded>(
    props.restore ?? { kind: "loading" },
  );
  const [models, setModels] = useState<ModelsView | null>(null);
  const [tab, setTab] = useState<EditorTab>("general");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [grants, setGrants] = useState<GrantsLoaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // 저장은 한 줄로 이어 보낸다. 앞 저장이 끝나기 전에 다음 변화를 보내면 옛 revision이라 conflict가 난다.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  // 이 화면이 시작해 아직 callback을 기다리는 MCP 로그인이다.
  const [signingIn, setSigningIn] = useState<readonly string[]>([]);
  // 탭을 떠났다 돌아왔으면 읽지 않고 그 편집에서 이어 간다. 한 번만 쓴다.
  const restored = useRef(props.restore ?? null);

  useEffect(() => {
    let live = true;
    void source.models().then((result) => {
      if (live) setModels(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [source]);

  useEffect(() => {
    if (restored.current !== null) {
      restored.current = null;
      return;
    }
    let live = true;
    setState({ kind: "loading" });
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

  // Grants 탭은 열 때 읽는다. 새 agent는 저장하기 전에는 붙일 수 없다.
  useEffect(() => {
    if (tab !== "grants" || agent === null) return;
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
  }, [source, workspace, agent, tab]);

  const ready = state.kind === "ready" ? state : null;
  const dirty = ready !== null && isDirty(ready);
  const lastReport = useRef(props.onState);
  lastReport.current = props.onState;
  const shownName =
    ready === null
      ? ""
      : (ready.definition.name ?? ready.detail.effective.name.value);
  const shownProfile: AvatarProfile | null = (() => {
    if (ready === null) return null;
    const profile =
      ready.definition.profile ?? ready.detail.effective.profile.value;
    return profile.kind === "character"
      ? profile
      : {
          kind: "image",
          src:
            ready.detail.assignment === null
              ? ""
              : source.imageSrc(
                  workspace,
                  ready.detail.assignment,
                  profile.image,
                ),
        };
  })();
  // 탭 줄이 이 agent의 이름과 아이콘을 보이도록 알린다(새 agent는 이름이 없어 제목 글이다).
  useEffect(() => {
    if (ready === null || shownProfile === null) return;
    lastReport.current?.({
      ready,
      dirty,
      face: {
        name:
          ready.detail.assignment === null && shownName.trim() === ""
            ? t("project-workspace.heading.agents-new-agent")
            : shownName,
        profile: shownProfile,
      },
    });
    // shownProfile은 매번 새로 만들어서 값으로 비교한다.
  }, [ready, dirty, shownName, JSON.stringify(shownProfile)]);

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
          props.onChanged();
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

  if (state.kind === "loading") return <Loading />;
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
  const { fresh, lophn, coding } = facts;
  const edit = (next: AgentDraft) =>
    setState((current) =>
      current.kind === "ready" ? { ...current, definition: next } : current,
    );
  const name = shownName;

  const remove = () => {
    if (detail.assignment === null || detail.hash === null) return;
    void source
      .deleteAgent(workspace ?? "", detail.assignment, detail.hash)
      .then((result) => {
        if (!result.ok) {
          setNotice({
            title: "agents.title.delete-failed",
            body: "project-workspace.notice.agents-delete-failed",
          });
          return;
        }
        props.onChanged();
        (props.onGone ?? props.onDone)();
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
          profile: { kind: "image", image: result.value.image },
        });
      });
  };

  // 할당은 정의 파일의 apps·permissions라 Grants 저장이 파일 hash를 바꾼다. 들고 있는 hash와 두 칸을 파일에 맞춰,
  // 이어지는 정의 저장이 conflict가 되거나 방금 바꾼 할당을 옛 값으로 덮지 않게 한다. 편집 중인 다른 칸은 그대로 둔다.
  const syncGrantsFile = async (assignment: string) => {
    const read = await source.readAgent(workspace, assignment);
    if (!read.ok) return;
    const stored = read.value.definition as {
      apps?: unknown;
      permissions?: unknown;
    };
    const merge = (draft: AgentDraft) => {
      const {
        apps: _apps,
        permissions: _permissions,
        ...rest
      } = draft as AgentDraft & { apps?: unknown; permissions?: unknown };
      return {
        ...rest,
        ...(stored.apps === undefined ? {} : { apps: stored.apps }),
        ...(stored.permissions === undefined
          ? {}
          : { permissions: stored.permissions }),
      } as AgentDraft;
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
  const tabs = visibleTabs(facts);
  // 고른 탭이 runtime을 바꿔 사라졌으면 General로 돌아온다.
  const shown: EditorTab = tabs.includes(tab) ? tab : "general";
  const marked = new Set(state.issues.map(tabOfIssue));
  const imageSrc = (image: string) =>
    detail.assignment === null
      ? ""
      : source.imageSrc(workspace, detail.assignment, image);

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
      <Tabs value={shown} onValueChange={(value) => setTab(value as EditorTab)}>
        <div className={styles.head}>
          <div className={styles.headRow}>
            <h1 className={styles.title}>
              {shownProfile === null ? null : (
                <Avatar profile={shownProfile} size="md" />
              )}
              {fresh ? t("project-workspace.heading.agents-new-agent") : name}
              {lophn || coding ? (
                <span className={styles.chip}>
                  {t("agents.label.built-in")}
                </span>
              ) : null}
            </h1>
            <div className={styles.formActions}>
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
            {tabs.map((one) => (
              <Tab
                key={one}
                size="sm"
                value={one}
                disabled={one === "grants" && fresh}
              >
                {t(TAB_LABEL[one])}
                {marked.has(one) && one !== shown ? (
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
        <TabPanel value="general">
          <GeneralTab
            {...form}
            facts={facts}
            imageSrc={imageSrc}
            onUpload={upload}
            onDelete={remove}
          />
        </TabPanel>
        <TabPanel value="runtime">
          <RuntimeTab {...form} facts={facts} models={models} source={source} />
        </TabPanel>
        <TabPanel value="instructions">
          <InstructionsTab
            {...form}
            workspaceInstructions={{
              read: () => source.readInstructions(workspace ?? ""),
              write: (text, hash) =>
                source.writeInstructions(workspace ?? "", text, hash),
            }}
          />
        </TabPanel>
        <TabPanel value="skills">
          <SkillsTab {...form} facts={facts} />
        </TabPanel>
        <TabPanel value="memory">
          <MemoryTab
            {...form}
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
        <TabPanel value="tools">
          <ToolsTab
            {...form}
            facts={facts}
            extensions={detail.extensions}
            onSignIn={signIn}
            onCancelSignIn={cancelSignIn}
            signingIn={signingIn}
          />
        </TabPanel>
        <TabPanel value="grants">
          {grants.kind === "loading" ? <Loading /> : null}
          {grants.kind === "failed" ? (
            <ErrorState
              target={t("agents.label.grants-target")}
              onRetry={() => setTab("general")}
            />
          ) : null}
          {grants.kind === "ready" ? (
            <>
              <GrantsPanel
                agentName={name}
                entries={grants.view.entries}
                catalog={grants.view.catalog}
                onChange={changeGrants}
              />
              <p className={`${styles.note} ${styles.stored}`}>
                {t("agents.notice.grants-apply-now")}
              </p>
            </>
          ) : null}
        </TabPanel>
      </Tabs>
    </div>
  );
}
