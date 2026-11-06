// 앱 자식마다 broker socket을 열고 서비스 어댑터를 조립한다.
// 업무 규칙은 packages/core/apps/permissions/broker에 있고 여기는 자식 연결 하나에 서비스를 달고 자식이
// 끝나면 정리하는 연결만 한다. 신원은 자식 연결이 정한다: 서비스는 본문의 신원 주장을 쓰지 않는다.
// 모르는 경로는 없는 경로와 같은 not_found다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppCallPort,
  type BrokerAccess,
  type BrokerChild,
  type BrokerHub,
  type BrokerServices,
  type BrokerSession,
  createAppsCallService,
  createBrokerEndpoint,
  createBrokerHub,
  createExceptionLogService,
  createNetFetchService,
  createNotifyService,
  createReadyService,
  createSecretUseService,
  type ExceptionLog,
  type NoticePostPort,
  type ReadyReceiver,
  type RedactionGate,
  type SecretDelivery,
  serveBroker,
} from "../../apps/permissions/mod.ts";

export type BrokerAdapters = {
  access: BrokerAccess;
  // 앱 시작이 DB를 바꿨을 때 앱 process가 `ready`로 보낸 changeset을 받는다.
  ready: ReadyReceiver;
  // 다른 앱 호출은 그 자식의 app credential로 core의 호출 경로를 부른다.
  appCall: AppCallPort;
  // 앱이 사람에게 알린다. 그 자식의 app credential로 core의 app_notices.post를 부른다.
  notice: NoticePostPort;
  // 앱이 loopback으로 닿지 못해야 하는 플랫폼 port. hello 뒤에 알려지므로 호출 때 읽는다.
  platformPorts: () => readonly number[];
  // 외부 전송. 시험이 local fake를 넣는다. 기본은 전역 fetch다.
  netTransport?: typeof globalThis.fetch;
  netScheme?: "https" | "http";
  // 잡은 예외를 그 앱 log 줄로 쓴다.
  exceptions: ExceptionLog;
  secrets: { delivery: SecretDelivery; redaction: RedactionGate };
};

// 자식 하나가 쓰는 broker 서비스들이다. 연결의 신원은 서비스 호출마다 endpoint가 넘긴다.
function servicesFor(adapters: BrokerAdapters): BrokerServices {
  const ports = adapters.platformPorts();
  return {
    ready: createReadyService({ receiver: adapters.ready }),
    net: createNetFetchService({
      access: adapters.access,
      platformPorts: ports,
      secrets: (invocation, host, port) =>
        adapters.secrets.delivery.attached(invocation, host, port),
      ...(adapters.netTransport === undefined
        ? {}
        : { transport: adapters.netTransport }),
      ...(adapters.netScheme === undefined
        ? {}
        : { scheme: adapters.netScheme }),
    }),
    secrets: createSecretUseService({
      access: adapters.access,
      delivery: adapters.secrets.delivery,
      redaction: adapters.secrets.redaction,
      platformPorts: ports,
    }),
    notify: createNotifyService({
      access: adapters.access,
      core: adapters.notice,
    }),
    exceptions: createExceptionLogService({ log: adapters.exceptions }),
    appsCall: createAppsCallService({ core: adapters.appCall }),
  };
}

type OpenedChild = {
  // 이 자식에게만 올릴 서비스다. 없으면 운영 서비스 묶음이다(preview 대역이 따로 올린다).
  services?: BrokerServices;
  child: BrokerChild;
  // 시작 입력의 자식 credential이다. argv·환경에는 없다.
  credential: string;
  // 이번 시작의 broker socket 자리다.
  socketPath: string;
};

export type SupervisorBroker = {
  readonly hub: BrokerHub;
  // 자식을 띄우기 전에 부른다. 자식이 연결하기 전에 socket이 이미 듣고 있어야 한다.
  open(opened: OpenedChild): Promise<Result<void>>;
  // 자식 종료를 확인했다. socket을 닫고 그 자식의 연결·점유·열린 기록을 정리한다.
  closed(processNonce: string): Promise<void>;
  // 그 앱의 모든 연결을 새 요청부터 막는다.
  blockApp(app: string): number;
};

type BrokerListening = { shutdown(): Promise<void> };

export function createSupervisorBroker(deps: {
  adapters: BrokerAdapters;
  // 시험이 socket 없이 endpoint만 쓰려고 바꾼다.
  serve?: (
    socketPath: string,
    endpoint: ReturnType<typeof createBrokerEndpoint>,
  ) => Promise<BrokerListening>;
  childExited?: (processNonce: string) => void;
}): SupervisorBroker {
  const hub = createBrokerHub();
  const serve = deps.serve ?? serveBroker;
  const listening = new Map<string, BrokerListening>();
  return {
    hub,
    async open(opened) {
      const session: BrokerSession = {
        child: opened.child,
        credential: opened.credential,
      };
      const endpoint = hub.register(
        session,
        opened.services ?? servicesFor(deps.adapters),
      );
      try {
        listening.set(
          opened.child.processNonce,
          await serve(opened.socketPath, endpoint),
        );
      } catch {
        hub.unregister(opened.child.processNonce);
        return err({
          code: "unavailable",
          message: "the broker socket could not be opened",
        });
      }
      return ok(undefined);
    },
    async closed(processNonce) {
      hub.unregister(processNonce);
      const found = listening.get(processNonce);
      listening.delete(processNonce);
      deps.childExited?.(processNonce);
      try {
        await found?.shutdown();
      } catch {
        /* 이미 닫힌 listener다 */
      }
    },
    blockApp: (app) => hub.blockApp(app),
  };
}
