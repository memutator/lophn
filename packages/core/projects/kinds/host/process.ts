// kinds worker(kind `documents/kinds`)를 core 쪽에서 띄운다. 첫 요청에서 platform 감독으로 띄우고,
// lophn 자신의 process라 권한 flag가 없어 읽을 경로가 늘어도 다시 띄우지 않는다.
//
// 이 모듈은 core의 module graph에 들어간다. node:sqlite와 동기 file API는 쓰지 않는다.
import type { Result } from "../../../../base/mod.ts";
import { KINDS_WORKER_KIND } from "../../../../protocol/projects/mod.ts";
import type {
  ChildMessage,
  KindLaunchSpec,
  ParentMessage,
} from "../../../../protocol/supervision/mod.ts";
import type {
  ChildCallbacks,
  StartResult,
} from "../../../supervision/responsiveness/mod.ts";
import { checkLaunchSpec } from "../../../supervision/security/mod.ts";

function kindsWorkerSpec(): KindLaunchSpec | undefined {
  const spec: KindLaunchSpec = {
    kind: KINDS_WORKER_KIND,
    entry: new URL("../worker/run.ts", import.meta.url).pathname,
    policy: "on_request",
    memory_limit_bytes: 512 * 1024 * 1024,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}

// worker 요청 통로. WorkerChannel 모양 중 쓰는 부분이다.
type KindsChannel = {
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  onMessage(message: ChildMessage): void;
  bind(send: ((payload: unknown) => Promise<boolean>) | null): void;
  failPending(message: string): void;
};

type KindsProcessDeps = {
  supervisor: {
    start(
      spec: unknown,
      hello: ParentMessage,
      callbacks: ChildCallbacks,
    ): Promise<StartResult>;
    updateSpec(
      spec: unknown,
      hello: ParentMessage,
      callbacks?: ChildCallbacks,
    ): Promise<StartResult>;
    send(kind: string, payload: unknown): Promise<StartResult>;
  };
  channel: KindsChannel;
  dataRoot: string;
  epoch: string;
  apiPort: number;
  // 띄우기 전에 worker가 쓸 폴더를 만든다(index를 여는 SQLite는 폴더가 없으면 실패한다).
  prepare(): Promise<void>;
};

export type KindsProcess = {
  // worker를 띄운다. 이미 떠 있으면 그대로 둔다.
  ensure(): Promise<boolean>;
  request(
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>>;
};

export function createKindsProcess(deps: KindsProcessDeps): KindsProcess {
  let started = false;
  let gaveUp = false;
  let chain: Promise<unknown> = Promise.resolve();

  const hello: ParentMessage = {
    type: "hello",
    core_epoch: deps.epoch,
    process_identity: deps.epoch,
    kind: KINDS_WORKER_KIND,
    task: "kinds",
    scope: { operations: [], targets: { data_root: deps.dataRoot } },
    // worker는 core에 닿지 않는다. 자격은 core가 쥐고 worker에 주지 않는다.
    credential: "none",
    api_port: deps.apiPort,
  };
  const callbacks: ChildCallbacks = {
    onMessage: (message) => deps.channel.onMessage(message),
    // 끝난 child에 보낸 요청은 답이 오지 않는다. 자동으로 다시 보내지 않는다.
    onEnd: () =>
      deps.channel.failPending("kinds worker가 끝나 요청이 끝나지 못했다"),
    onGiveUp: () => {
      gaveUp = true;
    },
  };

  async function launch(): Promise<boolean> {
    const spec = kindsWorkerSpec();
    if (spec === undefined) return false;
    try {
      await deps.prepare();
    } catch {
      return false;
    }
    // 감독이 포기한 slot은 start로 다시 열 수 없다. 새 spec으로 교체해야 다시 띄운다.
    const launched = gaveUp
      ? await deps.supervisor.updateSpec(spec, hello, callbacks)
      : await deps.supervisor.start(spec, hello, callbacks);
    if (!launched.ok) return false;
    started = true;
    gaveUp = false;
    deps.channel.bind((payload) =>
      deps.supervisor.send(KINDS_WORKER_KIND, payload).then((sent) => sent.ok),
    );
    return true;
  }

  return {
    ensure() {
      const run = chain.then(async () => {
        if (started && !gaveUp) return true;
        return await launch();
      });
      chain = run.catch(() => undefined);
      return run;
    },
    request: (op, payload, timeoutMs) =>
      deps.channel.request(op, payload, timeoutMs),
  };
}
