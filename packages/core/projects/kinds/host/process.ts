// kinds worker(kind `documents/kinds`)를 core 쪽에서 띄운다. 첫 요청에서 platform 감독으로 띄우고, 읽을
// 경로(그릇 폴더, kinds 파일)가 늘면 새 권한으로 다시 띄운다.
//
// 이 모듈은 core의 module graph에 들어간다. node:sqlite와 동기 file API는 쓰지 않는다.
import type { Result } from "../../../../base/mod.ts";
import {
  KINDS_WORKER_KIND,
  kindsIndexPath,
} from "../../../../protocol/projects/mod.ts";
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

// child가 코드와 deno 캐시를 올리는 읽기. 사용자 폴더가 아니다.
function codeReads(): string[] {
  const repo = new URL("../../../../../", import.meta.url).pathname.replace(
    /\/$/,
    "",
  );
  const home = Deno.env.get("HOME");
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없으면 기본 위치를 쓴다 */ }
  const cache = configured ?? (home ? `${home}/.cache/deno` : "/tmp");
  return [repo, cache];
}

// 권한: 읽기는 그릇 폴더·kinds 파일·자기 index, 쓰기는 index(+WAL)뿐이다.
// network·env·subprocess·FFI는 없다. `--no-prompt`는 launchArgv가 낸다.
function kindsWorkerSpec(input: {
  dataRoot: string;
  reads: readonly string[];
}): KindLaunchSpec | undefined {
  const index = kindsIndexPath(input.dataRoot);
  const files = [index, `${index}-wal`, `${index}-shm`, `${index}-journal`];
  const spec: KindLaunchSpec = {
    kind: KINDS_WORKER_KIND,
    entry: new URL("../worker/run.ts", import.meta.url).pathname,
    allow_read: [
      ...new Set([
        ...input.reads.filter((path) => path !== input.dataRoot),
        ...files,
        ...codeReads(),
      ]),
    ],
    allow_write: files,
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: [],
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
  // 띄우기 전에 worker가 쓸 폴더를 만든다(worker는 자기 index 폴더를 만들 권한이 없다).
  prepare(): Promise<void>;
};

export type KindsProcess = {
  // worker가 이 경로들(그릇 폴더, kinds 파일)을 읽을 수 있게 띄운다. 이미 그렇게 떠 있으면 그대로 둔다.
  ensure(reads: readonly string[]): Promise<boolean>;
  request(
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>>;
};

export function createKindsProcess(deps: KindsProcessDeps): KindsProcess {
  let allowed: string[] | undefined;
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

  async function launch(reads: string[]): Promise<boolean> {
    const spec = kindsWorkerSpec({ dataRoot: deps.dataRoot, reads });
    if (spec === undefined) return false;
    try {
      await deps.prepare();
    } catch {
      return false;
    }
    const replace = allowed !== undefined || gaveUp;
    const started = replace
      ? await deps.supervisor.updateSpec(spec, hello, callbacks)
      : await deps.supervisor.start(spec, hello, callbacks);
    if (!started.ok) return false;
    allowed = reads;
    gaveUp = false;
    deps.channel.bind((payload) =>
      deps.supervisor.send(KINDS_WORKER_KIND, payload).then((sent) => sent.ok)
    );
    return true;
  }

  return {
    ensure(reads) {
      const run = chain.then(async () => {
        const known = allowed ?? [];
        if (
          allowed !== undefined && !gaveUp &&
          reads.every((path) => known.includes(path))
        ) {
          return true;
        }
        return await launch([...new Set([...known, ...reads])].sort());
      });
      chain = run.catch(() => undefined);
      return run;
    },
    request: (op, payload, timeoutMs) =>
      deps.channel.request(op, payload, timeoutMs),
  };
}
