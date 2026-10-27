// agent 하나의 설정 화면. Project Manager, App Engineer, Operator, lophn이 같은 화면을 쓰고 새 Operator 만들기도 같다.
// Definition 탭에 profile·이름·놓을 곳·지침·model·skill·MCP가 있고 Grants 탭에서 맡길 것을 붙인다. source에서 agent를
// 읽어 form 값을 쥐고, 저장·삭제·이미지 올리기·grant 바꾸기를 source로 보낸다. 저장 실패·충돌 같은 알림은 그 탭 위쪽 toast다.

import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { Dialog, Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import type { MessageKey } from "@lophn/wording";
import { t } from "@lophn/wording";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceIcons } from "../../../icons/mod.ts";
import { Avatar, type AvatarProfile } from "../../../parts/avatar/avatar.tsx";
import type { DomainView } from "../../source.ts";
import type {
  AgentDetail,
  AgentDraft,
  AgentsSource,
  GrantsView,
  ModelsView,
} from "../source.ts";
import styles from "./agent-editor.module.css";
import { DefinitionForm } from "./definition-form.tsx";
import { GrantsPanel } from "./grants-panel.tsx";
import { ROLE_LABEL } from "./parts.tsx";

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
  | "domains"
  | "refreshModels"
  | "setHidden"
  | "userModels"
  | "saveModelInfo"
  | "removeModelInfo"
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

// domain과 skill 이름은 놓을 곳의 것이라 곳을 바꾸면 비운다.
function withoutPlaceFields(definition: AgentDraft): AgentDraft {
  const { domains: _domains, skills: _skills, ...rest } = definition;
  return rest;
}

function Loading(): ReactElement {
  return (
    <div className={styles.fill} data-agent-editor="loading">
      <Skeleton shape="line" lines={6} />
    </div>
  );
}

// 지우기는 확인을 한 번 받은 뒤에만 부른다. 저장은 확인이 없다.
function DeleteOperator({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
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
  // 저장은 한 줄로 이어 보낸다. 앞 저장이 끝나기 전에 다음 변화를 보내면 옛 revision이라 conflict가 난다.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const [domains, setDomains] = useState<readonly DomainView[] | null>(null);

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

  // Operator가 고를 domain은 놓인 곳 그릇의 것이다. 새 Operator는 놓을 곳을 바꾸면 다시 읽는다.
  const placeId =
    state.kind !== "ready"
      ? null
      : state.detail.assignment === null
        ? place.slice(place.indexOf(":") + 1)
        : state.detail.place.id;
  useEffect(() => {
    setDomains(null);
    if (placeId === null || placeId === "") return;
    let live = true;
    void source.domains(placeId).then((result) => {
      if (live) setDomains(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [source, placeId]);

  // Grants 탭은 열 때 읽는다. 새 Operator는 저장하기 전에는 붙일 수 없다.
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

  // 새 Operator의 놓을 곳을 바꾸면 그 곳에서 보이는 skill·MCP·지침을 다시 읽고, 그 곳 domain이 아닌 값은 정의에서 뺀다.
  const changePlace = (next: string) => {
    setPlace(next);
    void source
      .newOperator(next.slice(next.indexOf(":") + 1))
      .then((result) => {
        if (!result.ok) return;
        const { skills, mcpServers, instructions } = result.value;
        setState((current) =>
          current.kind !== "ready"
            ? current
            : {
                ...current,
                detail: { ...current.detail, skills, mcpServers, instructions },
                definition: withoutPlaceFields(current.definition),
              },
        );
      });
  };

  const save = () => {
    // 그릇에 없어진 domain은 저장에서 뺀다(칸은 안내만 보인다). 비면 칸 자체를 뺀다.
    const { domains: chosen = [], ...rest } = definition;
    const here = domains?.map((one) => one.id);
    const stay =
      here === undefined ? chosen : chosen.filter((id) => here.includes(id));
    void source
      .saveAgent(project, {
        assignment: detail.assignment,
        draftId: detail.draftId,
        place: fresh ? place.slice(place.indexOf(":") + 1) : null,
        definition: stay.length === 0 ? rest : { ...rest, domains: stay },
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
        {fresh ? null : (
          <span className={styles.chip}>{t(ROLE_LABEL[detail.role])}</span>
        )}
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
            source={source}
            placeName={props.projectName}
            domains={domains}
            place={place}
            onPlace={changePlace}
            imageSrc={(image) =>
              detail.assignment === null
                ? ""
                : source.imageSrc(project, detail.assignment, image)
            }
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
          {detail.kind === "operator" && !fresh ? (
            <DeleteOperator name={name} onDelete={remove} />
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
