// agent 하나의 설정 화면. 저장된 agent와 새 agent가 같은 화면을 쓴다.
// Definition 탭에 profile·이름·지침·model·skill·MCP가 있고 Grants 탭에서 맡길 것을 붙인다. source에서 agent를
// 읽어 form 값을 쥐고, 저장·삭제·이미지 올리기·grant 바꾸기를 source로 보낸다. 저장 실패·충돌 같은 알림은 그 탭 위쪽 toast다.

import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { Dialog, Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import type { MessageKey } from "@lophn/i18n";
import { t } from "@lophn/i18n";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { LOPHN_AGENT_ID } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar, type AvatarProfile } from "../../../parts/avatar/avatar.tsx";
import type {
  AgentDetail,
  AgentDraft,
  AgentsSource,
  GrantsView,
  ModelsView,
} from "../source.ts";
import type { McpLogin, McpRow, McpStatus } from "../views.ts";
import styles from "./agent-editor.module.css";
import { DefinitionForm } from "./definition-form.tsx";
import { GrantsPanel } from "./grants-panel.tsx";

/** editor가 source에서 쓰는 것. 설정 화면의 lophn 편집도 이만 채우면 된다. */
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
>;

interface AgentEditorProps {
  readonly source: AgentEditorSource;
  /** agent가 놓인 곳의 id(project나 앱). lophn 전체 설정은 null이다. */
  readonly project: string | null;
  /** 그 곳의 이름. */
  readonly projectName: string;
  /** 열 agent를 가리키는 값. 새 agent는 null이다. */
  readonly agent: string | null;
  /** 저장·삭제·취소로 editor를 떠난다. */
  readonly onDone: () => void;
  /** 목록이나 정의가 바뀌었다. */
  readonly onChanged: () => void;
  /** 폭과 여백을 이미 둔 기둥(Settings) 안에 놓인다. 없으면 탭 본문처럼 스스로 기둥을 둔다. */
  readonly inColumn?: boolean;
}

type Section = "definition" | "grants";

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly detail: AgentDetail;
      readonly definition: AgentDraft;
      readonly issues: readonly AgentDefinitionIssue[];
    };

type GrantsLoaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly view: GrantsView };

interface Notice {
  readonly title: MessageKey;
  readonly body: MessageKey;
}

function Loading(): ReactElement {
  return (
    <div className={styles.fill} data-agent-editor="loading">
      <Skeleton shape="line" lines={6} />
    </div>
  );
}

// 지우기는 확인을 한 번 받은 뒤에만 부른다. 저장은 확인이 없다.
function DeleteAgent({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className={styles.danger}>
      <Button icon={actionIcons.delete} onClick={() => setAsking(true)}>
        {t("project-workspace.button.agent-editor-delete")}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t("project-workspace.heading.agent-editor-delete-title", {
          name,
        })}
        actions={
          <>
            <Button onClick={() => setAsking(false)}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.delete}
              onClick={() => {
                setAsking(false);
                onDelete();
              }}
            >
              {t("project-workspace.button.agent-editor-delete-confirm")}
            </Button>
          </>
        }
      >
        <p>{t("project-workspace.notice.agent-editor-delete-body")}</p>
      </Dialog>
    </div>
  );
}

export function AgentEditor(props: AgentEditorProps): ReactElement {
  const { source, project, agent } = props;
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [models, setModels] = useState<ModelsView | null>(null);
  const [tab, setTab] = useState<Section>("definition");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [grants, setGrants] = useState<GrantsLoaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // 저장은 한 줄로 이어 보낸다. 앞 저장이 끝나기 전에 다음 변화를 보내면 옛 revision이라 conflict가 난다.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  // 이 화면이 시작해 아직 callback을 기다리는 MCP 로그인이다.
  const [signingIn, setSigningIn] = useState<readonly string[]>([]);

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
    let live = true;
    setState({ kind: "loading" });
    const opened =
      agent === null
        ? source.newAgent(project)
        : source.readAgent(project, agent);
    void opened.then((result) => {
      if (!live) return;
      if (!result.ok) {
        // 열어 둔 agent가 이미 없으면 목록으로 돌아간다.
        if (agent !== null && result.message === "not_found") props.onDone();
        else setState({ kind: "failed" });
        return;
      }
      setState({
        kind: "ready",
        detail: result.value,
        definition: result.value.definition,
        issues: result.value.issues,
      });
    });
    return () => {
      live = false;
    };
    // props.onDone은 부르는 쪽이 만드는 함수라 바뀔 때마다 다시 읽지 않는다.
  }, [source, project, agent, attempt]);

  // Grants 탭은 열 때 읽는다. 새 agent는 저장하기 전에는 붙일 수 없다.
  useEffect(() => {
    if (tab !== "grants" || agent === null) return;
    let live = true;
    setGrants({ kind: "loading" });
    void source.grants(project, agent).then((result) => {
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
  }, [source, project, agent, tab]);

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
  const fresh = detail.assignment === null;
  const lophn = detail.assignment === LOPHN_AGENT_ID;
  const edit = (next: AgentDraft) =>
    setState((current) =>
      current.kind === "ready" ? { ...current, definition: next } : current,
    );
  const name = definition.name ?? detail.effective.name.value;
  const shown: AvatarProfile = (() => {
    const profile = definition.profile ?? detail.effective.profile.value;
    return profile.kind === "character"
      ? profile
      : {
          kind: "image",
          src:
            detail.assignment === null
              ? ""
              : source.imageSrc(project, detail.assignment, profile.image),
        };
  })();

  const save = () => {
    void source
      .saveAgent(project, {
        assignment: detail.assignment,
        draftId: detail.draftId,
        definition,
        hash: detail.hash,
      })
      .then((result) => {
        if (result.ok) {
          setNotice(null);
          props.onChanged();
          props.onDone();
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

  const remove = () => {
    if (detail.assignment === null || detail.hash === null) return;
    void source
      .deleteAgent(project ?? "", detail.assignment, detail.hash)
      .then((result) => {
        if (!result.ok) {
          setNotice({
            title: "agents.title.delete-failed",
            body: "project-workspace.notice.agents-delete-failed",
          });
          return;
        }
        props.onChanged();
        props.onDone();
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
    void source.uploadImage(project, detail.assignment, file).then((result) => {
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
    const read = await source.readAgent(project, assignment);
    if (!read.ok) return;
    const stored = read.value.definition as {
      apps?: unknown;
      permissions?: unknown;
    };
    setState((current) => {
      if (current.kind !== "ready") return current;
      const {
        apps: _apps,
        permissions: _permissions,
        ...rest
      } = current.definition as AgentDraft & {
        apps?: unknown;
        permissions?: unknown;
      };
      const definition = {
        ...rest,
        ...(stored.apps === undefined ? {} : { apps: stored.apps }),
        ...(stored.permissions === undefined
          ? {}
          : { permissions: stored.permissions }),
      } as AgentDraft;
      return {
        ...current,
        detail: { ...current.detail, hash: read.value.hash },
        definition,
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
        project,
        assignment,
        entries,
        revision.current,
      );
      if (result.ok) {
        revision.current = result.value.revision;
        await syncGrantsFile(assignment);
        return;
      }
      const fresh = await source.grants(project, assignment);
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

  return (
    <div
      className={`${styles.page} ${props.inColumn ? styles.inColumn : ""}`}
      data-agent-editor="ready"
    >
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
      <h1 className={styles.title}>
        <Avatar profile={shown} size="md" />
        {fresh ? t("project-workspace.heading.agents-new-agent") : name}
        {lophn ? (
          <span className={styles.chip}>{t("agents.label.built-in")}</span>
        ) : null}
      </h1>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Section)}>
        <TabList>
          <Tab value="definition">{t("agents.label.tab-definition")}</Tab>
          <Tab value="grants" disabled={fresh}>
            {t("agents.label.tab-grants")}
          </Tab>
        </TabList>
        <TabPanel value="definition">
          <DefinitionForm
            detail={detail}
            definition={definition}
            extensions={detail.extensions}
            issues={state.issues}
            models={models}
            source={source}
            workspaceName={props.projectName}
            imageSrc={(image) =>
              detail.assignment === null
                ? ""
                : source.imageSrc(project, detail.assignment, image)
            }
            onChange={edit}
            onUpload={upload}
            onSignIn={signIn}
            onCancelSignIn={cancelSignIn}
            signingIn={signingIn}
            projectInstructions={{
              read: () => source.readInstructions(project ?? ""),
              write: (text, hash) =>
                source.writeInstructions(project ?? "", text, hash),
            }}
          />
          <div className={styles.formActions}>
            <Button onClick={props.onDone}>{t("common.button.cancel")}</Button>
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
          <p className={`${styles.note} ${styles.stored}`}>
            {fresh ? `${t("agents.notice.grants-after-create")} ` : ""}
            {t("project-workspace.notice.agent-editor-model-help")}{" "}
            {t("agents.notice.stored-in-lophn")}
          </p>
          {!fresh && !lophn ? (
            <DeleteAgent name={name} onDelete={remove} />
          ) : null}
        </TabPanel>
        <TabPanel value="grants">
          {grants.kind === "loading" ? <Loading /> : null}
          {grants.kind === "failed" ? (
            <ErrorState
              target={t("agents.label.grants-target")}
              onRetry={() => setTab("definition")}
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
