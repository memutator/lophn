// core가 준비되지 않았거나 시작에 실패했을 때 Home 자리에 서는 화면. workspace 창과 같은 shell 틀에 빈 왼쪽 sidebar와
// tab 줄을 두고, 가운데 card에 준비 중 화면이나 시작 실패(core 시작, 높은 schema 등)의 다음 행동 하나를 보인다.
// 준비되면 같은 틀의 Home 창으로 바뀌어 틀이 튀지 않는다. 다른 기계의 창이면 가운데가 그 기계의 gate(붙는 중, 꺼짐, 지워짐)다.
import type { ReactNode } from "react";

import type { CoreSource } from "../connection/connection.ts";
import {
  ConnectionGate,
  retryConnection,
  useConnection,
} from "../connection/connection.tsx";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { useWindowMachine } from "../machines/context.tsx";
import { MachineGate } from "../machines/machine-gate.tsx";
import { MachineSwitcher } from "../machines/machine-switcher.tsx";
import type { SettingsPane } from "../settings/model.ts";
import { ShellFrame, useSidebarOpen } from "../../shell/shell-frame.tsx";
import { failureOf } from "./start-failure/model.ts";
import { StartFailureScreen } from "./start-failure/start-failure.tsx";
import styles from "./home-gate.module.css";

/** 시작 화면의 틀. HomeGate와 gallery의 시작 실패 견본이 같이 쓴다. */
export function GateFrame({
  platform,
  machineSwitcher,
  children,
}: {
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  machineSwitcher?: ReactNode;
  children: ReactNode;
}) {
  const [left, setLeft] = useSidebarOpen("left", true);
  return (
    <div className={styles.window} data-space="home" data-gated="">
      <ShellFrame
        left={left}
        onToggleLeft={() => setLeft(!left)}
        right={false}
        {...(platform === undefined ? {} : { platform })}
        machineSwitcher={machineSwitcher}
        tabs={null}
        leftSidebar={null}
      >
        <div className={styles.card}>{children}</div>
      </ShellFrame>
    </div>
  );
}

export function HomeGate({
  source,
  platform,
  onSettings,
}: {
  source: CoreSource;
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  /** 기계 고르기의 "Pair another computer…"가 Settings › Remote로 간다. */
  onSettings?: (pane: SettingsPane) => void;
}) {
  const connection = useConnection(source);
  const machine = useWindowMachine();
  const retry = () => retryConnection(source);
  const failure = failureOf(connection);
  return (
    <GateFrame
      {...(platform === undefined ? {} : { platform })}
      machineSwitcher={
        <MachineSwitcher onPairAnother={() => onSettings?.("remote")} />
      }
    >
      {machine !== null ? (
        <MachineGate
          machine={machine}
          connection={connection}
          onRetry={retry}
        />
      ) : failure !== null ? (
        <StartFailureScreen failure={failure} onRetry={retry} />
      ) : (
        <ConnectionGate connection={connection} />
      )}
    </GateFrame>
  );
}
