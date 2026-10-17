// Agents 탭의 본문 전체. 목록(AgentsTab)과 같은 탭 안에서 여는 editor(AgentEditor)를 source에 잇는다. 읽기와 설정 바꾸기는
// 여기서 쥐고, 바꾸지 못했다는 알림은 탭 위쪽 toast다. 열어 둔 agent는 탭의 필드(layout)에 남고, 첫 저장 전의 새 Operator는
// 이 탭 안의 상태일 뿐이다.
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import { AgentsTab } from "./agents-tab.tsx";
import { AgentEditor, type ContextOption } from "./editor/agent-editor.tsx";
import styles from "./agents-tab.module.css";
import type { AgentsOverview, AgentsSource, ModelsView } from "./source.ts";

interface AgentsPageProps {
  project: string;
  projectName: string;
  source: AgentsSource;
  /** 탭이 열어 둔 agent를 가리키는 값. 없으면 목록이다. */
  agent: string | null;
  /** 열어 둔 agent를 바꾼다(탭 필드). null이면 목록으로 돌아간다. */
  onAgent: (assignment: string | null) => void;
  /** Operator에 붙일 수 있는 이 project의 context. */
  contexts: readonly ContextOption[];
  /** project의 LOPHN.md를 연다. 통로가 없으면 단추는 아무것도 하지 않는다. */
  onEditInstructions: () => void;
  /** Skills·MCP servers의 [Add …]. 등록 form은 lophn 공간이 갖고 있다. */
  onAddExtension: () => void;
  /** 목록이나 정의가 바뀌었다. sidebar의 Agents 묶음이 다시 읽는다. */
  onChanged: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: AgentsOverview };

export function AgentsPage(props: AgentsPageProps): ReactElement {
  const { project, source, agent } = props;
  const [overview, setOverview] = useState<Loaded>({ kind: "loading" });
  const [models, setModels] = useState<ModelsView | null>(null);
  const [reloads, setReloads] = useState(0);
  const [failed, setFailed] = useState(false);
  // 첫 저장 전의 새 Operator editor. 열어 둔 agent가 있으면 그쪽이 먼저다.
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    void source.overview(project).then((result) => {
      if (!live) return;
      setOverview(
        result.ok ? { kind: "ready", value: result.value } : { kind: "failed" },
      );
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

  if (agent !== null || creating) {
    const leave = () => {
      setCreating(false);
      props.onAgent(null);
      reload();
    };
    return (
      <AgentEditor
        source={source}
        project={project}
        projectName={props.projectName}
        agent={agent}
        contexts={props.contexts}
        onDone={leave}
        onChanged={props.onChanged}
        onEditProjectInstructions={props.onEditInstructions}
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

  // 설정을 바꾸는 명령 하나. 성공하면 다시 읽고 실패하면 바뀌지 않았다고 알린다.
  const change = (run: () => Promise<{ ok: boolean }>) => {
    void run().then((result) => {
      setFailed(!result.ok);
      reload();
    });
  };

  return (
    <>
      {failed
        ? (
          <div className={styles.toastSlot}>
            <Toast
              tone="error"
              title={t("agents.title.change-failed")}
              body={t("project-workspace.notice.agents-change-failed")}
              onClose={() => setFailed(false)}
            />
          </div>
        )
        : null}
      <AgentsTab
        projectName={props.projectName}
        overview={overview.value}
        models={models}
        imageSrc={(assignment, image) =>
          source.imageSrc(project, assignment, image)}
        onOpenAgent={(assignment) => props.onAgent(assignment)}
        onNewOperator={() => setCreating(true)}
        onEditInstructions={props.onEditInstructions}
        onProjectModel={(choice: ModelChoice | null) =>
          change(() => source.setProjectModel(project, choice))}
        onToggleSkill={(name, on) =>
          change(() => source.setSkill(project, name, on))}
        onAddSkill={props.onAddExtension}
        onToggleMcp={(name, on) =>
          change(() => source.setMcp(project, name, on))}
        onAddServer={props.onAddExtension}
      />
    </>
  );
}
