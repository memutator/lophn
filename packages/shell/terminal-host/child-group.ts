// Linux·macOS는 process group, Windows는 Job Object로 child를 함께 끝낸다.
// 종료 확인 전 PID만으로 성공을 주장하지 않는다.
// 신호를 보낸 직후의 동기 대기는 프로세스를 멈춰 자식이 신호를 처리하지 못한다.
// 확인은 호출자가 이벤트 루프를 돌린 뒤 alive()로 한다.

type KillResult =
  | { confirmed: true }
  | {
      confirmed: false;
      reason: string;
    };

export interface ProcessGroup {
  readonly pid: number;
  kill(signal?: NodeJS.Signals): KillResult;
  alive(): boolean;
}

export function posixGroup(pid: number): ProcessGroup {
  return {
    pid,
    kill(signal = "SIGTERM") {
      try {
        process.kill(-pid, signal);
      } catch (error) {
        if (isGone(error)) return { confirmed: true };
        return { confirmed: false, reason: "kill_failed" };
      }
      // 신호 직후 동기 대기는 프로세스를 멈춰 자식이 신호를 처리하지 못한다.
      // 아직 살아 있으면 확인 실패다. 호출자가 한 턴 뒤에 다시 본다.
      if (!alive(pid)) return { confirmed: true };
      return { confirmed: false, reason: "still_alive" };
    },
    alive() {
      return alive(pid);
    },
  };
}

function alive(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return !isGone(error);
  }
}

function isGone(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ESRCH"
  );
}
