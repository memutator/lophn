// 프로세스 수명의 호출 상태. entry가 만들어 넘긴다.
import type { Clock, IdSource } from "@lophn/base";
import type { Blueprint } from "../../blueprint/mod.ts";
import { type ConfirmMarkers, createConfirmMarkers } from "./confirm-marker.ts";
import type { BrokerClient } from "./broker-client.ts";
import type { ProcessIdentity } from "./verify.ts";
import type { VerifyKey } from "./signature.ts";
import type { InvocationCaller, Json } from "./wire.ts";

export type InvocationProgress = "running" | "succeeded" | "failed" | "unknown";

export type InvocationRecord = {
  id: string;
  requestKey: string;
  command: string;
  effect: "read" | "write" | "external";
  caller: InvocationCaller;
  progress: InvocationProgress;
  result?: Json;
  recorded: boolean;
  // 취소 요청을 받았다는 사실뿐이다. 효과가 취소됐다는 뜻이 아니다.
  cancelRequested?: boolean;
  // handler가 효과 전에 받지 않겠다고 알린 호출. 효과 없음이 알려진 실패다.
  rejection?: { code: string; message: string };
  // 종료 사실(timeout의 결과 모름)을 이미 보냈다. 늦은 handler 종료가 그 사실을 바꾸지 않는다.
  settled?: boolean;
  startedAt?: string;
};

export type ViewSession = {
  id: string;
  screen: string;
  size: "full" | "panel" | "card";
};

export type RuntimeState = {
  identity: ProcessIdentity;
  blueprint: Blueprint;
  key: VerifyKey;
  clock: Clock;
  ids: IdSource;
  broker: BrokerClient;
  dataSchema: number;
  directSocket: string;
  ready: boolean;
  accepting: boolean;
  closed: boolean;
  invocations: Map<string, InvocationRecord>;
  byRequest: Map<string, string>;
  markers: ConfirmMarkers;
  views: Map<string, ViewSession>;
  // 닫히거나 교체된 view session. 늦게 온 화면 요청이 닫힌 session을 되살리지 못한다. 상한을 넘으면
  // 가장 오래된 것부터 잊는다.
  closedViews: Set<string>;
  screenBytes: (screen: string, path: string) => Uint8Array | undefined;
  contentType: (path: string) => string;
  // handler가 잡은 예외를 process를 끝내지 않고 보고한다. 없으면 보고하지 않는다.
  reportCaught?: (error: Error, invocation: string) => void;
};

export const CLOSED_VIEW_LIMIT = 1024;

export function closeView(state: RuntimeState, viewSession: string): void {
  state.views.delete(viewSession);
  state.closedViews.delete(viewSession);
  state.closedViews.add(viewSession);
  while (state.closedViews.size > CLOSED_VIEW_LIMIT) {
    const oldest = state.closedViews.values().next().value;
    if (oldest === undefined) break;
    state.closedViews.delete(oldest);
  }
}

export function createRuntimeState(input: {
  identity: ProcessIdentity;
  blueprint: Blueprint;
  key: VerifyKey;
  clock: Clock;
  ids: IdSource;
  broker: BrokerClient;
  dataSchema: number;
  directSocket: string;
  screenBytes?: (screen: string, path: string) => Uint8Array | undefined;
  contentType?: (path: string) => string;
}): RuntimeState {
  return {
    ...input,
    ready: false,
    accepting: false,
    closed: false,
    invocations: new Map(),
    byRequest: new Map(),
    markers: createConfirmMarkers(),
    views: new Map(),
    closedViews: new Set(),
    screenBytes: input.screenBytes ?? (() => undefined),
    contentType: input.contentType ??
      ((path) =>
        path.endsWith(".js") ? "text/javascript" : "application/octet-stream"),
  };
}
