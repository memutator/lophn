import { err, ok, type Result } from "../../../base/mod.ts";

// architecture 2.3 입장·실행 한도의 고정 값. 일반 설정으로 격리나 한도를 해제하지 않는다.
export const COMMAND_ADMISSION_TOTAL = 256;
export const COMMAND_ADMISSION_PRINCIPAL = 64;
export const COMMAND_CONTROL_RESERVED = 16;
export const COMMAND_START_WAIT_MS = 5_000;

export const HTTP_CONCURRENT_TOTAL = 128;
export const HTTP_CONCURRENT_PRINCIPAL = 16;

export const EVENT_CONNECTION_TOTAL = 32;
export const EVENT_CONNECTION_PRINCIPAL = 4;

export const READ_EXEC = 2;
export const READ_WAIT_TOTAL = 64;
export const READ_WAIT_PRINCIPAL = 8;

// caller의 priority 주장은 입력에 없다. 입장 영역만 회수·정지 제어를 위한 control lane이다.
export type AdmissionLane = "normal" | "control";

export type Arrival = { release(): void };

export type Admission = {
  // command 입장 대기. principal별 FIFO·principal 사이 round-robin으로 실행 슬롯에 들어간다.
  // 대기 5초를 넘은 대기자는 잘라내고 false다. 실행 시작은 여기서 하지 않는다.
  admit(
    principal: string,
    work: () => Promise<void>,
    lane?: AdmissionLane,
  ): Promise<boolean>;
  // HTTP 동시 요청 한도. queue 없이 즉시 결정한다. 초과는 unavailable이다.
  enterHttp(principal: string): Result<Arrival>;
  // event 연결 한도. queue 없이 즉시 결정한다.
  enterEvent(principal: string): Result<Arrival>;
  readonly command: { readonly queued: number; readonly active: number };
  readonly httpActive: number;
  readonly connections: number;
};

type Job = {
  principal: string;
  work: () => Promise<void>;
  settle(admitted: boolean): void;
  timer: ReturnType<typeof setTimeout>;
};

const unavailable = () =>
  err({
    code: "unavailable" as const,
    message: "admission 한도를 넘었다",
  });

// control lane은 일반 queue가 가득 차라도 쓸 수 있는 예약 자리다.
// normal lane은 예약을 쓸 수 없으므로 전체에서 예약을 뺀 자리만 본다.
const NORMAL_LIMIT = COMMAND_ADMISSION_TOTAL - COMMAND_CONTROL_RESERVED;

export function createAdmission(
  // 테스트가 기한을 줄일 때만 쓴다. 기본값은 architecture 2.3의 고정 값이다.
  startWaitMs: number = COMMAND_START_WAIT_MS,
): Admission {
  const queues = new Map<string, Job[]>();
  const principals: string[] = [];
  const control: Job[] = [];
  let queued = 0;
  let active = 0;
  let httpActive = 0;
  const httpByPrincipal = new Map<string, number>();
  let connections = 0;
  const connectionsByPrincipal = new Map<string, number>();

  function dropNormal(job: Job) {
    clearTimeout(job.timer);
    const queue = queues.get(job.principal);
    if (!queue) return;
    const index = queue.indexOf(job);
    if (index < 0) return;
    queue.splice(index, 1);
    queued--;
    job.settle(false);
  }

  function dropControl(job: Job) {
    clearTimeout(job.timer);
    const index = control.indexOf(job);
    if (index < 0) return;
    control.splice(index, 1);
    job.settle(false);
  }

  function takeNormal(): Job | undefined {
    while (principals.length) {
      const principal = principals.shift()!;
      const queue = queues.get(principal);
      if (!queue || !queue.length) {
        queues.delete(principal);
        continue;
      }
      const job = queue.shift()!;
      queued--;
      if (queue.length) principals.push(principal);
      else queues.delete(principal);
      return job;
    }
    return undefined;
  }

  // control을 먼저 꺼내고 남은 슬롯으로 normal queue를 꺼낸다.
  function pump() {
    while (active < COMMAND_ADMISSION_TOTAL) {
      const job = control.shift() ?? takeNormal();
      if (!job) break;
      active++;
      clearTimeout(job.timer);
      // 슬롯을 준 시점이 입장이다. work의 처음은 여기서 시작한다.
      job.settle(true);
      void job.work().catch(() => undefined).finally(() => {
        active--;
        pump();
      });
    }
  }

  function enqueue(
    principal: string,
    work: () => Promise<void>,
    lane: AdmissionLane,
    settle: (admitted: boolean) => void,
  ): boolean {
    // close()는 없다. 프로세스 수명의 상태는 entry가 만들고 프로세스와 함께 끝난다.
    if (lane === "control") {
      if (control.length >= COMMAND_CONTROL_RESERVED) return false;
    } else {
      if ((queues.get(principal)?.length ?? 0) >= COMMAND_ADMISSION_PRINCIPAL) {
        return false;
      }
      if (queued >= NORMAL_LIMIT) return false;
    }
    const job: Job = {
      principal,
      work,
      settle,
      timer: setTimeout(
        lane === "control" ? () => dropControl(job) : () => dropNormal(job),
        startWaitMs,
      ),
    };
    // settle은 pump가 슬롯을 줄 때와 timer가 자를 때 두 곳에서만 온다.
    if (lane === "control") control.push(job);
    else {
      const queue = queues.get(principal);
      if (queue) queue.push(job);
      else {
        queues.set(principal, [job]);
        principals.push(principal);
      }
      queued++;
    }
    pump();
    return true;
  }

  return {
    admit(principal, work, lane = "normal") {
      return new Promise<boolean>((resolve) => {
        const entered = enqueue(principal, work, lane, resolve);
        if (!entered) resolve(false);
      });
    },
    enterHttp(principal) {
      if (httpActive >= HTTP_CONCURRENT_TOTAL) return unavailable();
      const own = httpByPrincipal.get(principal) ?? 0;
      if (own >= HTTP_CONCURRENT_PRINCIPAL) return unavailable();
      httpActive++;
      httpByPrincipal.set(principal, own + 1);
      let released = false;
      return ok({
        release: () => {
          if (released) return;
          released = true;
          httpActive--;
          const count = httpByPrincipal.get(principal) ?? 1;
          if (count <= 1) httpByPrincipal.delete(principal);
          else httpByPrincipal.set(principal, count - 1);
        },
      });
    },
    enterEvent(principal) {
      if (connections >= EVENT_CONNECTION_TOTAL) return unavailable();
      const own = connectionsByPrincipal.get(principal) ?? 0;
      if (own >= EVENT_CONNECTION_PRINCIPAL) return unavailable();
      connections++;
      connectionsByPrincipal.set(principal, own + 1);
      let released = false;
      return ok({
        release: () => {
          if (released) return;
          released = true;
          connections--;
          const count = connectionsByPrincipal.get(principal) ?? 1;
          if (count <= 1) connectionsByPrincipal.delete(principal);
          else connectionsByPrincipal.set(principal, count - 1);
        },
      });
    },
    get command() {
      return { queued, active };
    },
    get httpActive() {
      return httpActive;
    },
    get connections() {
      return connections;
    },
  };
}
