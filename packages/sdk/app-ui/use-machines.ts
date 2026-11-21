import { useCallback, useEffect, useRef, useState } from "react";

// 앱 view preload bridge `lophnApp.machines`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).

/**
 * 사람의 컴퓨터(폰 제외). `id`는 `connectCommands(…, { on })`에 그대로 쓰고, `status`의 이름은 `@lophn/ui`의
 * `MachineOption`과 같아 목록을 `MachineSelector`의 `machines`에 그대로 넘길 수 있다.
 */
export interface Machine {
  /** 컴퓨터 id(`mch_`). */
  id: string;
  name: string;
  status: "online" | "offline" | "connecting" | "update";
  /** 이 화면의 backend가 도는 컴퓨터. 하나뿐이다. */
  current: boolean;
  /** 그 컴퓨터가 "늘 켜 둠"으로 표시됐나. 그 컴퓨터의 기록이 아직 없으면 null. */
  always_on: boolean | null;
}

export interface MachinesBridge {
  machines: {
    list(): Promise<
      | { ok: true; value: { machines: Machine[] } }
      | { ok: false; error: { code: string; message: string } }
    >;
  };
}

function machinesBridge(): MachinesBridge | undefined {
  const app = (globalThis as { lophnApp?: Partial<MachinesBridge> }).lophnApp;
  return app?.machines === undefined ? undefined : (app as MachinesBridge);
}

export type MachinesState =
  | { status: "loading" }
  | { status: "ready"; machines: Machine[] }
  | { status: "failed"; code: string };

export interface UseMachines {
  state: MachinesState;
  /** 다시 읽는다. 읽는 동안 state는 이전 값 그대로다. */
  reload: () => void;
}

/**
 * 사람의 컴퓨터 명단을 화면이 열릴 때 한 번 읽는다. 켜짐 상태는 `reload`로 다시 읽는다. 앱 view 밖이거나 이 기능이 없는
 * lophn이면 `failed`(`unavailable`)다.
 */
export function useMachines(
  app: MachinesBridge | undefined = machinesBridge(),
): UseMachines {
  const [state, setState] = useState<MachinesState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: round는 다시 읽기 신호다.
  useEffect(() => {
    const mine = ++latest.current;
    if (app === undefined) {
      setState({ status: "failed", code: "unavailable" });
      return;
    }
    void app.machines
      .list()
      .catch(() => ({ ok: false as const, error: { code: "unavailable" } }))
      .then((reply) => {
        if (mine !== latest.current) return;
        setState(
          reply.ok
            ? { status: "ready", machines: reply.value.machines }
            : { status: "failed", code: reply.error.code },
        );
      });
  }, [app, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { state, reload };
}
