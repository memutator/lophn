import {
  type PointerEvent,
  type ReactElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { FloatPanel, Tooltip } from "@lophn/ui/overlay";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import { conversationIcons, workspaceIcons } from "../../../icons/mod.ts";
import type { AgentTabSourceFactory } from "../../../conversation/agent-tab-source.ts";
import {
  AgentView,
  type AgentViewHost,
} from "../../../conversation/agent-view.tsx";
import { DraftStore } from "../../../conversation/drafts.ts";
import { useConversation } from "../../../conversation/window-deps.tsx";
import { startPointerDrag } from "../../../workspace/drag.ts";
import {
  clampFloatRect,
  type FloatArea,
  type FloatEdge,
  type FloatRect,
  movedRect,
  resizedRect,
} from "../../../workspace/model.ts";
import type { SettingsPane } from "../../settings/model.ts";
import { runToastAction } from "../../connection/toasts/toast-actions.ts";
import styles from "./lophn-panel.module.css";

const WIDTH = 440;
const HEIGHT = 640;
const MARGIN = 16;

// 오른쪽 아래 구석. 창이 작으면 clampFloatRect가 가둔다.
function initialRect(area: FloatArea): FloatRect {
  return clampFloatRect(
    {
      x: area.width - WIDTH - MARGIN,
      y: area.height - HEIGHT - MARGIN,
      width: WIDTH,
      height: HEIGHT,
    },
    area,
  );
}

interface LophnPanelProps {
  factory: AgentTabSourceFactory;
  /** 보는 session. null은 아직 만들지 않은 새 session이다. */
  session: string | null;
  onSession: (session: string | null) => void;
  /** 패널만 닫는다. session은 그대로 남는다. */
  onClose: () => void;
  /** Settings로 이동한다. */
  onSettings?: (pane?: SettingsPane) => void;
}

// 런처 위에 뜨는 lophn 대화. 안은 탭과 같은 AgentView이고 이 틀만 다르다. 틀은 design FloatPanel이고 위치·크기는
// 이 창이 쥔 메모리다(저장하지 않는다).
export function LophnPanel({
  factory,
  session,
  onSession,
  onClose,
  onSettings,
}: LophnPanelProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<FloatArea | null>(null);
  const [saved, setSaved] = useState<FloatRect | null>(null);
  // 이동·resize 중 미리보기. 놓을 때만 saved에 올린다.
  const [preview, setPreview] = useState<FloatRect | null>(null);
  const [full, setFull] = useState(false);

  useLayoutEffect(() => {
    const element = hostRef.current;
    if (element === null) return;
    const measure = () =>
      setArea((current) =>
        current?.width === element.clientWidth &&
        current.height === element.clientHeight
          ? current
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const source = useMemo(
    () => factory({ assignment: "lophn", place: { kind: "global", id: "" } }),
    [factory],
  );
  const shared = useConversation()?.drafts;
  const local = useMemo(() => new DraftStore(), []);
  const host: AgentViewHost = {
    openPermissions: () => onSettings?.("agents"),
    openAgentSettings: () => onSettings?.("tools"),
    // Fork가 만든 session은 같은 패널에서 연다.
    openForked: (forked) => onSession(forked),
    // lophn이 맡긴 일을 받은 session 같은 것은 그 session의 창으로 간다(toast의 [Open]과 같은 길).
    openSession: (target) =>
      runToastAction({ kind: "session", session: target }),
    showUsage: () => {},
    closeTab: onClose,
    ...(onSettings === undefined
      ? {}
      : { openConnections: () => onSettings("providers") }),
  };

  const usable = area !== null && area.width > 0 && area.height > 0;
  const base = usable ? clampFloatRect(saved ?? initialRect(area), area) : null;
  const rect = preview ?? base;

  const drag = (
    event: PointerEvent<HTMLElement>,
    next: (dx: number, dy: number) => FloatRect,
  ) => {
    let last: FloatRect | null = null;
    startPointerDrag(event, {
      move: (dx, dy) => {
        last = next(dx, dy);
        setPreview(last);
      },
      finish: (outcome) => {
        setPreview(null);
        if (outcome.type === "drag-end" && last !== null) setSaved(last);
      },
    });
  };

  const close = t("common.button.close");
  return (
    <div ref={hostRef} className={styles.host} data-lophn-panel-host="">
      {rect !== null && area !== null && base !== null ? (
        <FloatPanel
          title={t("launcher.title.lophn-panel")}
          icon={
            <Icon icon={conversationIcons.dock} pixels={iconPixels("small")} />
          }
          full={full}
          x={full ? 0 : rect.x}
          y={full ? 0 : rect.y}
          width={full ? area.width : rect.width}
          height={full ? area.height : rect.height}
          active
          onMoveStart={
            full
              ? undefined
              : (event) =>
                  drag(event, (dx, dy) => movedRect(base, dx, dy, area))
          }
          onResizeStart={
            full
              ? undefined
              : (edge: FloatEdge, event) =>
                  drag(event, (dx, dy) => resizedRect(base, edge, dx, dy, area))
          }
          actions={
            <>
              <Tooltip
                content={
                  full
                    ? t("launcher.button.float-mode")
                    : t("launcher.button.full-mode")
                }
              >
                <IconButton
                  icon={full ? workspaceIcons.float : workspaceIcons.restore}
                  label={
                    full
                      ? t("launcher.button.float-mode")
                      : t("launcher.button.full-mode")
                  }
                  size="sm"
                  data-lophn-panel-mode={full ? "full" : "float"}
                  onClick={() => setFull((f) => !f)}
                />
              </Tooltip>
              <Tooltip content={close}>
                <IconButton
                  icon={workspaceIcons.close}
                  label={close}
                  size="sm"
                  data-lophn-panel-close=""
                  onClick={onClose}
                />
              </Tooltip>
            </>
          }
        >
          <div className={styles.agent}>
            <AgentView
              source={source}
              drafts={shared ?? local}
              session={session}
              onSessionChange={onSession}
              host={host}
              trailing={
                full ? (
                  <>
                    <Tooltip content={t("launcher.button.float-mode")}>
                      <IconButton
                        icon={workspaceIcons.float}
                        label={t("launcher.button.float-mode")}
                        size="sm"
                        data-lophn-panel-mode="float"
                        onClick={() => setFull(false)}
                      />
                    </Tooltip>
                    <Tooltip content={close}>
                      <IconButton
                        icon={workspaceIcons.close}
                        label={close}
                        size="sm"
                        data-lophn-panel-close=""
                        onClick={onClose}
                      />
                    </Tooltip>
                  </>
                ) : undefined
              }
            />
          </div>
        </FloatPanel>
      ) : null}
    </div>
  );
}
