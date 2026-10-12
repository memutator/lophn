// 앱 자식마다 broker socket을 열고 서비스 어댑터를 조립한다.
// 업무 규칙은 packages/core/apps/permissions/broker에 있고 여기는 자식 연결 하나에 서비스를 달고 자식이
// 끝나면 정리하는 연결만 한다. 신원은 자식 연결이 정한다: 서비스는 본문의 신원 주장을 쓰지 않는다.
// 모르는 경로는 없는 경로와 같은 not_found이고, 아직 이어지지 않은 외부 통로(secret 전송·문서 저장)는
// 경로를 없애지 않고 서비스의 검사를 지난 뒤 unavailable로 닫는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppPairConfirmer,
  type AppPairPreparer,
  type AppsConnectRequest,
  type BrokerAccess,
  type BrokerChild,
  type BrokerHub,
  type BrokerServices,
  type BrokerSession,
  createAppsConfirmService,
  createAppsConnectService,
  createAutomationBroker,
  createBrokerEndpoint,
  createBrokerHub,
  createDocumentSaveService,
  createNetFetchService,
  createProblemReportService,
  createSecretUseService,
  type DocumentsSave,
  type InvocationBroker,
  type ProblemsReport,
  type RedactionGate,
  type SecretDelivery,
  serveBroker,
} from "../../apps/permissions/mod.ts";
import type { AutomationPermits } from "../../apps/automations/permits.ts";

export type BrokerAdapters = {
  access: BrokerAccess;
  // 앱이 보낸 invocation 후행 기록을 core에 전달한다.
  invocations: Pick<InvocationBroker, "submit">;
  // automation 전체 동시 한도의 permit이다. supervisor에 하나뿐이다.
  permits: AutomationPermits;
  // 앱이 loopback으로 닿지 못해야 하는 플랫폼 port. hello 뒤에 알려지므로 호출 때 읽는다.
  platformPorts: () => readonly number[];
  // 외부 전송. 시험이 local fake를 넣는다. 기본은 전역 fetch다.
  netTransport?: typeof globalThis.fetch;
  netScheme?: "https" | "http";
  problems: (child: BrokerChild) => ProblemsReport;
  documents?: DocumentsSave;
  secrets?: { delivery: SecretDelivery; redaction: RedactionGate };
  pairs?: { preparer: AppPairPreparer; confirmer: AppPairConfirmer };
};

const NOT_CONNECTED = "this path is not connected to its platform service";

// 아직 platform 쪽 실제 경로가 없는 통로다. 서비스가 선언·grant·mode 검사를 마친 뒤에만 닿으므로
// 허락 범위 밖 요청은 평소와 같은 forbidden이고, 허락된 요청만 unavailable이다. 성공을 꾸미지 않는다.
const closedDocuments: DocumentsSave = {
  save: () =>
    Promise.resolve(err({ code: "unavailable", message: NOT_CONNECTED })),
};
const closedSecretDelivery: SecretDelivery = {
  use: () =>
    Promise.resolve(err({ code: "unavailable", message: NOT_CONNECTED })),
};
const closedRedaction: RedactionGate = {
  ensure: () => err({ code: "unavailable", message: NOT_CONNECTED }),
};
const closedPairs: { preparer: AppPairPreparer; confirmer: AppPairConfirmer } =
  {
    preparer: {
      prepare: (_request: AppsConnectRequest) =>
        Promise.resolve(err({ code: "unavailable", message: NOT_CONNECTED })),
    },
    confirmer: {
      request: () =>
        Promise.resolve(err({ code: "unavailable", message: NOT_CONNECTED })),
      poll: () =>
        Promise.resolve(err({ code: "unavailable", message: NOT_CONNECTED })),
    },
  };

// 자식 하나가 쓰는 broker 서비스들이다. 연결의 신원은 서비스 호출마다 endpoint가 넘긴다.
export function servicesFor(
  child: BrokerChild,
  adapters: BrokerAdapters,
): BrokerServices {
  const ports = adapters.platformPorts();
  const pairs = adapters.pairs ?? closedPairs;
  const secrets = adapters.secrets ??
    { delivery: closedSecretDelivery, redaction: closedRedaction };
  return {
    invocations: adapters.invocations,
    net: createNetFetchService({
      access: adapters.access,
      platformPorts: ports,
      ...(adapters.netTransport === undefined
        ? {}
        : { transport: adapters.netTransport }),
      ...(adapters.netScheme === undefined
        ? {}
        : { scheme: adapters.netScheme }),
    }),
    secrets: createSecretUseService({
      access: adapters.access,
      delivery: secrets.delivery,
      redaction: secrets.redaction,
      platformPorts: ports,
    }),
    documents: createDocumentSaveService({
      access: adapters.access,
      documents: adapters.documents ?? closedDocuments,
    }),
    problems: createProblemReportService({
      access: adapters.access,
      problems: adapters.problems(child),
    }),
    apps: createAppsConnectService({ preparer: pairs.preparer }),
    appsConfirm: createAppsConfirmService({ confirmer: pairs.confirmer }),
    automations: createAutomationBroker({
      access: adapters.access,
      permits: adapters.permits,
    }),
  };
}

export type OpenedChild = {
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
  open(opened: OpenedChild): Result<void>;
  // 자식 종료를 확인했다. socket을 닫고 그 자식의 연결·점유·열린 기록을 정리한다.
  closed(processNonce: string): Promise<void>;
  // 그 앱의 모든 연결을 새 요청부터 막는다.
  blockApp(app: string): number;
};

export type BrokerListening = { shutdown(): Promise<void> };

export function createSupervisorBroker(deps: {
  adapters: BrokerAdapters;
  // 시험이 socket 없이 endpoint만 쓰려고 바꾼다.
  serve?: (
    socketPath: string,
    endpoint: ReturnType<typeof createBrokerEndpoint>,
  ) => BrokerListening;
  childExited?: (processNonce: string) => void;
}): SupervisorBroker {
  const hub = createBrokerHub();
  const serve = deps.serve ?? serveBroker;
  const listening = new Map<string, BrokerListening>();
  return {
    hub,
    open(opened) {
      const session: BrokerSession = {
        child: opened.child,
        credential: opened.credential,
      };
      const endpoint = hub.register(
        session,
        opened.services ?? servicesFor(opened.child, deps.adapters),
      );
      try {
        listening.set(
          opened.child.processNonce,
          serve(opened.socketPath, endpoint),
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
      deps.adapters.permits.childExited(processNonce);
      deps.childExited?.(processNonce);
      try {
        await found?.shutdown();
      } catch { /* 이미 닫힌 listener다 */ }
    },
    blockApp: (app) => hub.blockApp(app),
  };
}
