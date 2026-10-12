// 호출 한 번이 지나간 단계 기록(apps/invocations#R11). handler 안의 SDK가 STAGE_PORT로 단계를 알리면
// 현재 호출 문맥의 invocation에 붙고, 호출이 끝날 때 요약에 실린다. 문맥 밖 호출은 버린다.
import {
  type InvocationStageState,
  STAGE_PORT,
  type StagePort,
} from "../../invocations/mod.ts";
import { ensureSchedulePort } from "./schedule.ts";
import { TRACE_NAME_MAX_CHARS } from "./limits.ts";

export const STAGE_LIMIT = 32;

export type RecordedStage = { name: string; state: InvocationStageState };

const stages = new Map<string, RecordedStage[]>();

function createStagePort(): StagePort {
  return {
    stage(name, state) {
      if (name.length === 0 || name.length > TRACE_NAME_MAX_CHARS) return;
      if (name.startsWith("inv_")) return;
      const invocation = ensureSchedulePort().current()?.invocation;
      if (!invocation) return;
      const list = stages.get(invocation);
      if (!list || list.length >= STAGE_LIMIT) return;
      list.push({ name, state });
    },
  };
}

// 먼저 설치한 쪽이 port를 소유하고 나중 load는 재사용한다.
export function ensureStagePort(): StagePort {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[STAGE_PORT];
  if (existing && typeof existing === "object") return existing as StagePort;
  const port = createStagePort();
  store[STAGE_PORT] = port;
  return port;
}

ensureStagePort();

export function openStages(invocation: string): void {
  stages.set(invocation, []);
}

// 호출이 끝나면 모은 단계를 꺼내고 자리를 비운다.
export function takeStages(invocation: string): RecordedStage[] {
  const list = stages.get(invocation) ?? [];
  stages.delete(invocation);
  return list;
}
