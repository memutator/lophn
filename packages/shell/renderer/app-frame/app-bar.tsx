// 앱 공간의 위쪽 바(`/apps/:app`). 앞쪽은 런처 복귀, 앱 이름, 연결 상태다. 뒤쪽은 글자 없이
// tooltip만 있는 아이콘 단추이고 순서는 [대기 목록] [Annotate] | [Agent, 앱 상세] | ⌘다. 켜진 것은 눌린 모양이다.
// 바는 shell 크롬이라 앱 view bounds에 들어가지 않는다.
import type { ReactNode } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { appSpaceIcons, editorIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import { PaletteButton, TopBar } from "../desktop/top-bar/top-bar.tsx";
import { LauncherButton } from "../workspace/launcher-button.tsx";
import { type AppStatus, statusLabel, statusTone } from "../apps/model.ts";
import styles from "./app-bar.module.css";

interface AppBarProps {
  /** 사람이 지은 앱 이름. 읽기 전에는 없다. */
  name: string | null;
  status: AppStatus | null;
  onLauncher: () => void;
  detailsOpen: boolean;
  onDetails: () => void;
  /** 없으면(annotate 통로가 없는 창) Annotate 단추를 두지 않는다. */
  annotate?: { readonly on: boolean; readonly onToggle: () => void };
  /** 대기 목록 pill. */
  decisions?: ReactNode;
  /** agent select. */
  agentSelect?: ReactNode;
}

function BarButton({
  icon,
  label,
  pressed,
  onClick,
  data,
}: {
  icon: (typeof appSpaceIcons)[keyof typeof appSpaceIcons];
  label: string;
  pressed?: boolean;
  onClick: () => void;
  data: string;
}) {
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

export function AppBar({
  name,
  status,
  onLauncher,
  detailsOpen,
  onDetails,
  annotate,
  decisions,
  agentSelect,
}: AppBarProps) {
  const marking = annotate !== undefined;
  return (
    <TopBar
      rail={<LauncherButton onLauncher={onLauncher} />}
      leading={
        <span className={styles.leading}>
          <span className={styles.name} data-app-name="">
            {name ?? ""}
          </span>
          {status ? (
            <span data-app-status={status}>
              <StatusMark
                tone={statusTone(status)}
                label={statusLabel(status)}
              />
            </span>
          ) : null}
        </span>
      }
      trailing={
        <span className={styles.trailing}>
          {decisions}
          {annotate === undefined ? null : (
            <BarButton
              icon={editorIcons.edit}
              label={t("app-space.button.annotate")}
              pressed={annotate.on}
              onClick={annotate.onToggle}
              data="annotate"
            />
          )}
          {marking ? <span className={styles.sep} aria-hidden="true" /> : null}
          {agentSelect}
          <BarButton
            icon={appSpaceIcons.appDetails}
            label={t("app-space.button.app-details")}
            pressed={detailsOpen}
            onClick={onDetails}
            data="app-details"
          />
          <span className={styles.sep} aria-hidden="true" />
          <PaletteButton />
        </span>
      }
    />
  );
}
