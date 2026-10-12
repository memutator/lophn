// 시작은 ready=false·accepting=false. 앱 code load 뒤에 등록 handler로 attestation을 만든다.
import type { Clock, IdSource } from "@lophn/base";
import type { Blueprint } from "../../blueprint/mod.ts";
import { installScreenContextHost } from "../../agent-context/mod.ts";
import {
  createPairPort,
  installPairPort,
  type PairDirect,
  unixPairDirect,
} from "../../connections/mod.ts";
import { type AppStart, parseAppStart } from "./start-input.ts";
import { type BrokerTransport, createBrokerClient } from "./broker-client.ts";
import { createCapHost, installCapHost } from "./cap-host.ts";
import { ensureSchedulePort } from "./schedule.ts";
import { createRuntimeState, type RuntimeState } from "./state.ts";
import { commandsMatchBlueprint } from "./control.ts";
import { decodeVerifyKey, type VerifyKey } from "./signature.ts";
import type { RuntimeMode } from "./wire.ts";

export type Started = {
  start: Omit<AppStart, "mode"> & { mode: RuntimeMode };
  state: RuntimeState;
};

export async function readStartLine(
  read: () => Promise<string | null>,
): Promise<string> {
  const line = await read();
  if (!line) throw new Error("app start input missing");
  return line;
}

export function startRuntime(deps: {
  line: string;
  blueprint: Blueprint;
  key?: VerifyKey;
  clock: Clock;
  ids: IdSource;
  broker: BrokerTransport;
  dataSchema: number;
  screenBytes?: RuntimeState["screenBytes"];
  contentType?: RuntimeState["contentType"];
  // 다른 앱 direct socket 전송. 기본은 Unix socket HTTP다.
  pairDirect?: PairDirect;
}): Started {
  const parsed = parseAppStart(deps.line);
  if (!parsed) throw new Error("app start input is invalid");
  const key = deps.key ?? decodeVerifyKey(parsed.verify_key);
  if (!key) throw new Error("verify key is invalid");
  const state = createRuntimeState({
    identity: {
      app: parsed.app,
      release: parsed.release,
      bundleHash: parsed.bundle_hash,
      mode: parsed.mode,
      processNonce: parsed.process_nonce,
    },
    blueprint: deps.blueprint,
    key,
    clock: deps.clock,
    ids: deps.ids,
    dataSchema: deps.dataSchema,
    directSocket: parsed.direct_socket,
    broker: createBrokerClient({
      transport: deps.broker,
      socketPath: parsed.broker_socket,
      credential: parsed.broker_credential,
      child: { process_nonce: parsed.process_nonce, mode: parsed.mode },
    }),
    screenBytes: deps.screenBytes,
    contentType: deps.contentType,
  });
  // 화면 context의 선언은 release에 고정된 blueprint에서, view는 이 프로세스가 연 session에서 온다.
  installScreenContextHost({
    declarations: () => state.blueprint.agent_context,
    view: (viewSession) => state.views.get(viewSession),
  });
  // SDK의 connectAppCommands가 쓰는 앱 쌍 통로다. 준비 요청만 broker로 가고 업무 요청은 direct다.
  installPairPort(createPairPort({
    postConnect: (body) => state.broker.appsConnect(body),
    postConfirmRequest: (body) => state.broker.appsConfirmRequest(body),
    postConfirmPoll: (body) => state.broker.appsConfirmPoll(body),
    direct: deps.pairDirect ?? unixPairDirect,
  }));
  // cap-net·cap-secret·cap-save·cap-store의 host다. broker 연결과 호출 문맥을 앱 코드에 내주지 않고
  // SDK가 port로만 쓴다(apps/sdk#R22–R32).
  installCapHost(createCapHost({
    mode: parsed.mode,
    dataPath: parsed.data_path,
    post: (path, body) => state.broker.post(path, body),
    current: () => ensureSchedulePort().current(),
  }));
  return { start: parsed, state };
}

export async function publishReady(state: RuntimeState): Promise<boolean> {
  if (!commandsMatchBlueprint(state)) return false;
  const response = await state.broker.ready({
    release: state.identity.release,
    bundle_hash: state.identity.bundleHash,
    commands: state.blueprint.commands.map((command) => command.key),
    data_schema: state.dataSchema,
    process_nonce: state.identity.processNonce,
    connection_ok: true,
  });
  return response.status === 200;
}
