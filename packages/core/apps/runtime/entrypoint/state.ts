// 프로세스 수명의 호출 상태. entry가 만들어 넘긴다.
import type { AppDeclaration } from "../../../../protocol/apps/declaration/mod.ts";
import type { BrokerClient } from "./broker-client.ts";
import type { StoreAccess } from "./cap-host.ts";

type ProcessIdentity = {
  app: string;
  release: string | null;
  bundleHash: string;
  mode: "live" | "preview";
  processNonce: string;
};

// 한 번에 하나만 돌리는 문이다. 앞 일이 실패해도 다음 일은 돈다.
type Mutex = <T>(work: () => Promise<T>) => Promise<T>;

function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export type RuntimeState = {
  identity: ProcessIdentity;
  declaration: AppDeclaration;
  broker: BrokerClient;
  store: StoreAccess;
  dataSchema: number;
  controlSocket: string;
  ready: boolean;
  accepting: boolean;
  closed: boolean;
  // 도는 호출 수. shutdown이 끝나기를 기다린다.
  running: number;
  // write·external 호출과 적용은 이 문을 지난다. SQLite session이 연결 단위라 겹치면 한 changeset에
  // 섞이기 때문이다.
  exclusive: Mutex;
  // handler가 잡은 예외를 process를 끝내지 않고 보고한다. 없으면 보고하지 않는다.
  reportCaught?: (error: Error, invocation: string) => void;
};

export function createRuntimeState(input: {
  identity: ProcessIdentity;
  declaration: AppDeclaration;
  broker: BrokerClient;
  store: StoreAccess;
  dataSchema: number;
  controlSocket: string;
}): RuntimeState {
  return {
    ...input,
    ready: false,
    accepting: false,
    closed: false,
    running: 0,
    exclusive: createMutex(),
  };
}
