// Agent view core source의 모듈들이 같이 쓰는 환경: 이 source가 묶인 agent와 자리, core 통로, 지금 시각,
// 한 번 읽으면 바뀌지 않는 event 시각 표, 같은 때 여러 곳이 묻는 run 목록.
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { SourceResult } from "./agent-source.ts";
import { type CoreLink, linkOf } from "./agent-core-source-link.ts";
import type { RunValue } from "./agent-core-source-values.ts";

export interface AgentTarget {
  readonly assignment: string;
  readonly place: {
    readonly kind: "global" | "project" | "app";
    readonly id: string;
  };
}

export interface AgentEnv {
  readonly link: CoreLink;
  readonly target: AgentTarget;
  readonly now: () => number;
  /** event seq → 그 event의 시각. event는 바뀌지 않으므로 한 번 읽으면 다시 읽지 않는다. */
  readonly times: Map<string, string>;
  /** 이 agent의 run 전부. 같은 때 여러 곳이 물으면 한 번만 읽는다. */
  runsOf(): Promise<SourceResult<RunValue[]>>;
  /** 이 시각(ISO). 시각을 모르는 줄이 쓴다. */
  nowIso(): string;
}

export function createEnv(
  core: CoreSource,
  target: AgentTarget,
  now: () => number,
): AgentEnv {
  const link = linkOf(core);
  let inFlight: Promise<SourceResult<RunValue[]>> | null = null;
  return {
    link,
    target,
    now,
    times: new Map(),
    runsOf() {
      if (inFlight === null) {
        const read = link.pages<RunValue>(
          "runs",
          "list",
          { assignment: target.assignment },
          "runs",
        );
        inFlight = read;
        void read.finally(() => {
          if (inFlight === read) inFlight = null;
        });
      }
      return inFlight;
    },
    nowIso: () => new Date(now()).toISOString(),
  };
}

/** 한 번에 묻는 subject 수. */
const SUBJECT_CHUNK = 100;
const EVENT_PAGES = 50;

interface EventsValue {
  events: { seq: string; at: string }[];
  scanned_through_seq: string;
  head_seq: string;
}

/**
 * event의 시각을 읽어 env.times에 채운다. 읽지 못한 것은 비워 두고 부르는 쪽이 대신할 시각을 정한다.
 * seq는 원장 전체에서 하나이므로 subject마다 따로 구별하지 않는다.
 */
export async function fillTimes(
  env: AgentEnv,
  wanted: readonly { subject: string; seq: string }[],
): Promise<void> {
  const missing = wanted.filter((item) => !env.times.has(item.seq));
  for (let start = 0; start < missing.length; start += SUBJECT_CHUNK) {
    const chunk = missing.slice(start, start + SUBJECT_CHUNK);
    const seqs = new Set(chunk.map((item) => item.seq));
    let after = chunk.reduce(
      (least, item) => {
        const value = BigInt(item.seq) - 1n;
        return value < least ? value : least;
      },
      BigInt(chunk[0]!.seq) - 1n,
    );
    if (after < 0n) after = 0n;
    const subjects = [...new Set(chunk.map((item) => item.subject))];
    for (let page = 0; page < EVENT_PAGES; page += 1) {
      const read = await env.link.read<EventsValue>("events", "list", {
        after_seq: String(after),
        subjects,
      });
      if (!read.ok) return;
      for (const event of read.value.events) {
        if (seqs.has(event.seq)) env.times.set(event.seq, event.at);
      }
      const scanned = BigInt(read.value.scanned_through_seq);
      if (scanned <= after || scanned >= BigInt(read.value.head_seq)) break;
      after = scanned;
    }
  }
}

/** 한 run이 이 session에 속하는지로 거른 run들. */
export function runsOfSession(
  runs: readonly RunValue[],
  session: string,
): RunValue[] {
  return runs.filter((run) => run.session === session);
}

/** 가장 늦게 접수된 run. 없으면 null이다. */
export function latestRun(runs: readonly RunValue[]): RunValue | null {
  let latest: RunValue | null = null;
  for (const run of runs) {
    if (
      latest === null || BigInt(run.accepted_seq) > BigInt(latest.accepted_seq)
    ) {
      latest = run;
    }
  }
  return latest;
}
