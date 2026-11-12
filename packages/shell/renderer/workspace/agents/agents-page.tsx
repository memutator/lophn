// Agents 탭의 본문 전체. 목록(AgentsTab)과 같은 탭 안에서 여는 editor(AgentEditor)를 source에 잇고, 위쪽 ← →로 목록과
// 이 탭에서 연 agent들 사이를 오간다(브라우저처럼). ← →는 card 머리 줄에 올리고, card 밖에서만 스스로 그린다. 읽기와 설정 바꾸기는 여기서 쥐고, 바꾸지 못했다는 알림은 탭 위쪽 toast다.
// 이동 기록과 저장하지 않은 편집은 창이 쥔 탭 상태(`AgentsTabs`)에 있어서 다른 탭에 다녀와도 남는다.
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import { useCommands } from "../../commands/react.tsx";
import { useCardHead } from "../../shell/card-head.tsx";
import { commonIcons } from "../../icons/mod.ts";
import { AgentsTab } from "./agents-tab.tsx";
import { AgentEditor } from "./editor/agent-editor.tsx";
import type { Ready } from "./editor/editor-model.ts";
import styles from "./agents-tab.module.css";
import type { AgentsOverview, AgentsSource, ModelsView } from "./source.ts";
import {
  agentOfPlace,
  AgentsTabs,
  back,
  canBack,
  canForward,
  type Face,
  forget,
  forward,
  here,
  type History,
  LIST,
  open,
  type Place,
  replace,
  samePlace,
  startHistory,
} from "./tab-state.ts";

interface AgentsPageProps {
  /** 이 탭의 workspace 열쇠: "home", project id, 앱 id. */
  workspace: string;
  workspaceName: string;
  source: AgentsSource;
  /** 이 탭의 key. 이동 기록과 편집이 이 key로 `tabs`에 남는다. */
  tabKey: string;
  tabs: AgentsTabs;
  /** 탭이 열어 둔 agent를 가리키는 값(layout에 남은 것). 이 창이 기록을 처음 만들 때의 시작점이다. */
  agent: string | null;
  /** 열어 둔 agent가 바뀌었다(탭 필드로 저장한다). null이면 목록이거나 저장 전의 새 agent다. */
  onAgent: (assignment: string | null) => void;
  /** 저장하지 않은 편집을 두고 떠나도 되는지 묻는다. 버리고 가겠다고 하면 true다. */
  askLeave: (name: string) => Promise<boolean>;
  /** Skills·MCP servers의 [Add …]. 등록 form은 Settings가 갖고 있다. */
  onAddExtension: () => void;
  /** 목록이나 정의가 바뀌었다. sidebar의 Agents 묶음이 다시 읽는다. */
  onChanged: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: AgentsOverview };

const placeKey = (place: Place): string =>
  place.kind === "list"
    ? "list"
    : place.kind === "agent"
      ? place.agent
      : `new:${place.n}`;

export function AgentsPage(props: AgentsPageProps): ReactElement {
  const { workspace, source, tabKey, tabs } = props;
  const [history, setHistory] = useState<History>(
    () => tabs.get(tabKey)?.history ?? startHistory(props.agent),
  );
  const latest = useRef(history);
  latest.current = history;
  const place = here(history);
  const agent = agentOfPlace(place);
  const [overview, setOverview] = useState<Loaded>({ kind: "loading" });
  const [models, setModels] = useState<ModelsView | null>(null);
  const [reloads, setReloads] = useState(0);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    void source.overview(workspace).then((result) => {
      if (!live) return;
      setOverview(
        result.ok ? { kind: "ready", value: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, workspace, reloads]);

  useEffect(() => {
    let live = true;
    void source.models().then((result) => {
      if (live) setModels(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [source]);

  // 열린 agent나 목록으로 가면 키(Ctrl+S, Alt+←)가 이 탭에서 닿도록 focus를 이 탭에 둔다. 다른 곳에 있던 focus는 뺏지 않는다.
  useEffect(() => {
    if (document.activeElement === document.body) {
      root.current?.focus({ preventScroll: true });
    }
  }, [placeKey(place)]);

  // 자리를 옮긴다. 옮기면 그 자리의 editor가 새로 열리므로 저장하지 않은 편집은 여기서 끝난다.
  const go = (next: History, face: Face | null = null) => {
    setHistory(next);
    tabs.set(tabKey, { history: next, draft: null, face });
    props.onAgent(agentOfPlace(here(next)));
  };

  // 편집이 남았으면 버려도 되는지 먼저 묻는다.
  const guarded = (move: () => void) => {
    if (!tabs.isDirty(tabKey)) {
      move();
      return;
    }
    void props
      .askLeave(tabs.faceOf(tabKey)?.name ?? "")
      .then((leave) => leave && move());
  };

  const goBack = () => guarded(() => go(back(latest.current)));
  const goForward = () => guarded(() => go(forward(latest.current)));
  // 머리 줄 spec은 기록이 바뀔 때만 다시 올리므로, 단추는 ref로 지금 render의 이동을 부른다.
  const moves = useRef({ goBack, goForward });
  moves.current = { goBack, goForward };
  const inCard = useCardHead(
    {
      nav: {
        canBack: canBack(history),
        canForward: canForward(history),
        onBack: () => moves.current.goBack(),
        onForward: () => moves.current.goForward(),
      },
    },
    [canBack(history), canForward(history)],
  );
  useCommands({ "agents.back": goBack }, { when: () => canBack(history) });
  useCommands(
    { "agents.forward": goForward },
    { when: () => canForward(history) },
  );

  const openAgent = (assignment: string) => {
    const row =
      overview.kind === "ready"
        ? overview.value.agents.find((one) => one.assignment === assignment)
        : undefined;
    go(
      open(latest.current, { kind: "agent", agent: assignment }),
      row === undefined
        ? null
        : {
            name: row.name,
            profile:
              row.profile.kind === "character"
                ? row.profile
                : {
                    kind: "image",
                    src: source.imageSrc(
                      row.workspace?.id ?? workspace,
                      assignment,
                      row.profile.image,
                    ),
                  },
          },
    );
  };
  const newAgent = () => {
    const news = latest.current.places.flatMap((one) =>
      one.kind === "new" ? [one.n] : [],
    );
    go(open(latest.current, { kind: "new", n: Math.max(0, ...news) + 1 }));
  };
  // [Cancel]은 이 편집을 버리겠다는 뜻이라 묻지 않는다.
  const toList = () => go(open(latest.current, LIST));
  // 지웠거나 이미 없어진 agent는 기록에서 빼고 목록으로 간다.
  const gone = () => {
    const current = here(latest.current);
    go(open(forget(latest.current, current), LIST));
    reload();
  };
  const saved = (assignment: string) =>
    go(replace(latest.current, { kind: "agent", agent: assignment }));

  const body = (): ReactElement => {
    // Home 목록에서 연 범위 agent는 그 agent의 workspace로 연다(탭에는 agent id만 남아 목록에서 찾는다).
    const home = workspace === "home";
    if (home && agent !== null && overview.kind === "loading") {
      return (
        <div className={styles.fill} data-agents-page="loading">
          <Skeleton shape="line" lines={6} />
        </div>
      );
    }
    if (place.kind !== "list") {
      const own =
        home && agent !== null && overview.kind === "ready"
          ? overview.value.agents.find((row) => row.assignment === agent)
          : undefined;
      const draft = tabs.get(tabKey)?.draft;
      const restore: Ready | null =
        draft !== null && draft !== undefined && samePlace(draft.place, place)
          ? draft.ready
          : null;
      return (
        <AgentEditor
          key={placeKey(place)}
          source={source}
          workspace={own?.workspace?.id ?? workspace}
          workspaceName={own?.workspaceName ?? props.workspaceName}
          agent={agent}
          restore={restore}
          onState={({ ready, dirty, face }) =>
            tabs.set(tabKey, {
              history: latest.current,
              draft: dirty ? { place, ready } : null,
              face,
            })
          }
          onDone={toList}
          onGone={gone}
          onSaved={saved}
          onChanged={() => {
            props.onChanged();
            reload();
          }}
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
        {failed ? (
          <div className={styles.toastSlot}>
            <Toast
              tone="error"
              title={t("agents.title.change-failed")}
              body={t("project-workspace.notice.agents-change-failed")}
              onClose={() => setFailed(false)}
            />
          </div>
        ) : null}
        <AgentsTab
          workspace={workspace}
          workspaceName={props.workspaceName}
          overview={overview.value}
          models={models}
          source={source}
          imageSrc={(assignment, image) =>
            source.imageSrc(workspace, assignment, image)
          }
          onOpenAgent={openAgent}
          onNewAgent={newAgent}
          instructions={{
            read: () => source.readInstructions(workspace),
            write: (text, hash) =>
              source.writeInstructions(workspace, text, hash),
          }}
          memory={{
            read: () => source.readMemory({ kind: "workspace", workspace }),
            write: (text, hash) =>
              source.writeMemory({ kind: "workspace", workspace }, text, hash),
          }}
          onWorkspaceModel={(choice: ModelChoice | null) =>
            change(() => source.setWorkspaceModel(workspace, choice))
          }
          onToggleSkill={(name, on) =>
            change(() => source.setSkill(workspace, name, on))
          }
          onAddSkill={props.onAddExtension}
          onToggleMcp={(name, on) =>
            change(() => source.setMcp(workspace, name, on))
          }
          onAddServer={props.onAddExtension}
        />
      </>
    );
  };

  return (
    <div
      ref={root}
      className={styles.shell}
      tabIndex={-1}
      data-key-context="agentsTab"
      // 마우스의 뒤로·앞으로 단추(3·4).
      onMouseUp={(event) => {
        if (event.button !== 3 && event.button !== 4) return;
        event.preventDefault();
        if (event.button === 3) goBack();
        else goForward();
      }}
    >
      {inCard ? null : (
        <div className={styles.nav}>
          <IconButton
            icon={commonIcons.back}
            label={t("agents.label.nav-back")}
            size="sm"
            variant="ghost"
            disabled={!canBack(history)}
            onClick={goBack}
          />
          <IconButton
            icon={commonIcons.forward}
            label={t("agents.label.nav-forward")}
            size="sm"
            variant="ghost"
            disabled={!canForward(history)}
            onClick={goForward}
          />
        </div>
      )}
      <div className={styles.scroll}>{body()}</div>
    </div>
  );
}
