// agent 하나의 설정 화면. Project Manager, App Engineer, Operator, lophn이 같은 화면을 쓰고 새 Operator 만들기도 같다.
// Definition 탭에 profile·이름·놓을 곳·지침·model·skill·MCP가 있고 Grants 탭에서 맡길 것을 붙인다. source에서 agent를
// 읽어 form 값을 쥐고, 저장·삭제·이미지 올리기·grant 바꾸기를 source로 보낸다. 저장 실패·충돌 같은 알림은 그 탭 위쪽 toast다.
import { type ReactElement, useEffect, useState } from "react";
import {
  Avatar,
  type AvatarProfile,
  Button,
  Dialog,
  ErrorState,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Toast,
} from "@lophn/design/components";
import { t } from "@lophn/wording";
import type { MessageKey } from "@lophn/wording";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type { AgentGrantEntry } from "../../../../../protocol/approvals/grants.ts";
import { workspaceIcons } from "../../../icons/mod.ts";
import type {
  AgentDetail,
  AgentDraft,
  AgentsSource,
  GrantsView,
  ModelsView,
} from "../source.ts";
import { type ContextOption, DefinitionForm } from "./definition-form.tsx";
import { GrantsPanel } from "./grants-panel.tsx";
import { ROLE_LABEL } from "./parts.tsx";
import styles from "./agent-editor.module.css";

export type { ContextOption };

/** editor가 source에서 쓰는 것. 설정 화면의 lophn 편집도 이만 채우면 된다. */
export type AgentEditorSource = Pick<
  AgentsSource,
  | "readAgent"
  | "newOperator"
  | "saveAgent"
  | "deleteAgent"
  | "uploadImage"
  | "imageSrc"
  | "models"
  | "grants"
  | "setGrants"
>;

interface AgentEditorProps {
  readonly source: AgentEditorSource;
  /** agent가 놓인 곳의 id(project나 앱). lophn 전체 설정은 null이다. */
  readonly project: string | null;
  /** 그 곳의 이름. */
  readonly projectName: string;
  /** 열 agent를 가리키는 값. 새 Operator는 null이다. */
  readonly agent: string | null;
  /** Operator에 붙일 수 있는 이 project의 context. */
  readonly contexts: readonly ContextOption[];
  /** 저장·삭제·취소로 editor를 떠난다. */
  readonly onDone: () => void;
  /** 목록이나 정의가 바뀌었다. */
  readonly onChanged: () => void;
  /** project의 LOPHN.md를 연다. */
  readonly onEditProjectInstructions: () => void;
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
function DeleteOperator(
  { name, onDelete }: { name: string; onDelete: () => void },
) {
  const [asking, setAsking] = useState(false);
  return (
    <div className={styles.danger}>
      <Button
        variant="danger"
        icon={workspaceIcons.trash}
        onClick={() => setAsking(true)}
      >
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
  const [place, setPlace] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [grants, setGrants] = useState<GrantsLoaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

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
    const opened = agent === null
      ? source.newOperator(project ?? "")
      : source.readAgent(project, agent);
    void opened.then((result) => {
      if (!live) return;
      if (!result.ok) {
        // 열어 둔 agent가 이미 없으면 목록으로 돌아간다.
        if (agent !== null && result.message === "not_found") props.onDone();
        else setState({ kind: "failed" });
        return;
      }
      const first = result.value.places[0];
      setPlace(first === undefined ? "" : `${first.kind}:${first.id}`);
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

  // Grants 탭은 열 때 읽는다. 새 Operator는 저장하기 전에는 붙일 수 없다.
  useEffect(() => {
    if (tab !== "grants" || agent === null) return;
    let live = true;
    setGrants({ kind: "loading" });
    void source.grants(project, agent).then((result) => {
      if (live) {
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
  const edit = (next: AgentDraft) =>
    setState((current) =>
      current.kind === "ready" ? { ...current, definition: next } : current
    );
  const name = definition.name ?? detail.effective.name.value;
  const shown: AvatarProfile = (() => {
    const profile = definition.profile ?? detail.effective.profile.value;
    return profile.kind === "icon" ? { kind: "icon", icon: profile.icon } : {
      kind: "image",
      src: detail.assignment === null
        ? ""
        : source.imageSrc(project, detail.assignment, profile.image),
    };
  })();

  const save = () => {
    void source.saveAgent(project, {
      assignment: detail.assignment,
      place: fresh ? place.slice(place.indexOf(":") + 1) : null,
      definition,
      hash: detail.hash,
    }).then((result) => {
      if (result.ok) {
        setNotice(null);
        props.onChanged();
        props.onDone();
        return;
      }
      setState((current) =>
        current.kind === "ready"
          ? { ...current, issues: result.issues }
          : current
      );
      setNotice(
        result.issues.length > 0 ? null : result.message === "conflict"
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
    void source.deleteAgent(project ?? "", detail.assignment, detail.hash)
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

  // Grants의 변화는 바로 저장한다. 저장하지 못하면 읽은 모양으로 되돌린다.
  const changeGrants = (entries: readonly AgentGrantEntry[]) => {
    if (grants.kind !== "ready" || detail.assignment === null) return;
    const before = grants.view;
    setGrants({ kind: "ready", view: { ...before, entries } });
    void source.setGrants(project, detail.assignment, entries).then(
      (result) => {
        if (result.ok) return;
        setGrants({ kind: "ready", view: before });
        setNotice({
          title: "agents.title.change-failed",
          body: "project-workspace.notice.agents-change-failed",
        });
      },
    );
  };

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
      <h1 className={styles.title}>
        <Avatar profile={shown} size="md" />
        {fresh ? t("project-workspace.heading.agents-new-operator") : name}
        {fresh
          ? null
          : <span className={styles.chip}>{t(ROLE_LABEL[detail.role])}</span>}
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
            issues={state.issues}
            models={models}
            placeName={props.projectName}
            contexts={props.contexts}
            place={place}
            onPlace={setPlace}
            imageSrc={(image) =>
              detail.assignment === null
                ? ""
                : source.imageSrc(project, detail.assignment, image)}
            onChange={edit}
            onUpload={upload}
            onEditProjectInstructions={props.onEditProjectInstructions}
          />
          <div className={styles.formActions}>
            <Button onClick={props.onDone}>{t("common.button.cancel")}</Button>
            <Button variant="primary" onClick={save}>
              {fresh
                ? t("agents.button.create-operator")
                : t("project-workspace.button.agent-editor-save")}
            </Button>
          </div>
          <p className={`${styles.note} ${styles.stored}`}>
            {fresh ? `${t("agents.notice.grants-after-create")} ` : ""}
            {t("project-workspace.notice.agent-editor-model-help")}{" "}
            {t("agents.notice.stored-in-lophn")}
          </p>
          {detail.kind === "operator" && !fresh
            ? <DeleteOperator name={name} onDelete={remove} />
            : null}
        </TabPanel>
        <TabPanel value="grants">
          {grants.kind === "loading" ? <Loading /> : null}
          {grants.kind === "failed"
            ? (
              <ErrorState
                target={t("agents.label.grants-target")}
                onRetry={() => setTab("definition")}
              />
            )
            : null}
          {grants.kind === "ready"
            ? (
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
            )
            : null}
        </TabPanel>
      </Tabs>
    </div>
  );
}
