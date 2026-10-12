// 앱 공간의 얇은 바(shell/app-frame#R26, architecture/shell 2.4 `/apps/:app`). 런처 복귀, 앱
// 이름과 연결 상태, [Report a problem] 자리, 운영 패널 진입, 문서 작업대 전환, 새 창 열기를 둔다.
// 이 공간의 lophn 크롬은 그 앱의 결정 대기와 lophn 장애 안내만이다(desktop#R27, `decisions`).
// 바는 shell 크롬이라 앱 view bounds에 들어가지 않는다.
import type { ReactNode } from "react";
import { IconButton, StatusMark, Tooltip } from "@lophn/design/components";
import { appSpaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import { TopBar } from "../desktop/top-bar/top-bar.tsx";
import { LauncherButton } from "../workspace/launcher-button.tsx";
import {
  type AppStatus,
  statusLabel,
  statusTone,
} from "../desktop/lophn-space/apps/model.ts";
import styles from "./app-bar.module.css";

export interface AppBarProps {
  /** 사람이 지은 앱 이름. 읽기 전에는 없다. */
  name: string | null;
  status: AppStatus | null;
  onLauncher: () => void;
  detailsOpen: boolean;
  onDetails: () => void;
  onDocuments: () => void;
  /** 없으면(전용 창 통로가 없는 창) 버튼을 두지 않는다. */
  onNewWindow?: () => void;
  /** 그 앱의 결정 대기와 lophn 장애 안내(SpaceDecisions). */
  decisions?: ReactNode;
  /** [Report a problem] 자리. 앱 view 캡처를 먼저 요청하는 독립 버튼이다(shell#T52). */
  report?: ReactNode;
  /** agent select. window controls 바로 옆, 곧 바 오른쪽의 맨 끝에 둔다(R37). */
  agentSelect?: ReactNode;
}

function BarButton(
  { icon, label, pressed, onClick, data }: {
    icon: (typeof appSpaceIcons)[keyof typeof appSpaceIcons];
    label: string;
    pressed?: boolean;
    onClick: () => void;
    data: string;
  },
) {
  return (
    <Tooltip content={label}>
      <IconButton
        icon={icon}
        label={label}
        aria-pressed={pressed}
        data-app-bar={data}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export function AppBar(
  {
    name,
    status,
    onLauncher,
    detailsOpen,
    onDetails,
    onDocuments,
    onNewWindow,
    decisions,
    report,
    agentSelect,
  }: AppBarProps,
) {
  return (
    <TopBar
      leading={
        <span className={styles.leading}>
          <LauncherButton onLauncher={onLauncher} />
          <span className={styles.name} data-app-name="">{name ?? ""}</span>
          {status
            ? (
              <span data-app-status={status}>
                <StatusMark
                  tone={statusTone(status)}
                  label={statusLabel(status)}
                />
              </span>
            )
            : null}
        </span>
      }
      trailing={
        <span className={styles.trailing}>
          {decisions}
          <span className={styles.report} data-report-slot="">{report}</span>
          <BarButton
            icon={appSpaceIcons.documents}
            label={t("app-space.button.documents")}
            onClick={onDocuments}
            data="documents"
          />
          {onNewWindow
            ? (
              <BarButton
                icon={appSpaceIcons.newWindow}
                label={t("app-space.button.new-window")}
                onClick={onNewWindow}
                data="new-window"
              />
            )
            : null}
          <BarButton
            icon={appSpaceIcons.appDetails}
            label={t("app-space.button.app-details")}
            pressed={detailsOpen}
            onClick={onDetails}
            data="app-details"
          />
          {agentSelect}
        </span>
      }
    />
  );
}
