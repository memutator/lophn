// 준비 worker pool. coordinator가 정확한 실행 파일(Deno + preparation-entry)로 준비 worker
// 두 slot을 띄우고 감독한다. 감독은 platform의 createSupervisor를
// slot마다 하나씩 쓴다: ready 기한, 3회 재기동과 backoff, process group 종료 확인이 같은
// 규칙이다. slot 하나는 한 번에 요청 하나만 처리한다. 사람이 기다리는 요청은 human slot을
// 먼저 쓰고, 바쁘면 background slot으로 흘리며, background 요청은 human slot이 놀 때만 쓴다.
// 같은 canonical 목표의 파일 작업은 pool이 줄을 세운다(두 준비 worker가 같은 파일을
// 동시에 쓰지 못하게). worker는 첫 요청에서 띄운다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import type {
  ChildMessage,
  KindLaunchSpec,
  ParentMessage,
} from "../../../../protocol/supervision/mod.ts";
import {
  type ChildCallbacks,
  createSupervisor,
  type Supervisor,
} from "../../../supervision/responsiveness/mod.ts";
import { createFileSerializer } from "../file-ops.ts";
import { systemClock } from "../../../../base/mod.ts";
import { type ByteInbox, createByteInbox } from "./byte-inbox.ts";

export const PREPARATION_KIND = "documents/preparation";
// 한 요청의 기한. 큰 파일 읽기·hash·쓰기를 덮는다. 넘으면 결과 불명이라 unavailable이다.
export const POOL_REQUEST_TIMEOUT_MS = 30_000;
const BYTE_CHUNK = 256 * 1024;

export type SlotName = "human" | "background";

// 바이트를 먼저 보내는 요청은 그 channel을 받아 payload를 만든다. 바이트를 돌려받는 요청
// (`replyBytes`)은 준비 worker가 응답 전에 byte frame을 보낼 channel도 받는다.
export type PoolPayload =
  | Record<string, unknown>
  | ((channel: number, replyChannel: number) => unknown);

export type PoolRequest = {
  op: string;
  payload: PoolPayload;
  bytes?: Uint8Array;
  // true면 준비 worker가 응답 전에 byte chunk frame으로 보낸 바이트를 모아 결과에
  // `{ payload, bytes }`로 싣는다. 응답 payload의 `bytes`(길이)와 받은 바이트가 다르면
  // 일부로 꾸미지 않고 unavailable이다. 한 frame(1 MiB) 안의 창 하나를 위한 길이다.
  replyBytes?: boolean;
  priority: SlotName;
  // 같은 key의 요청은 줄을 선다(canonical 파일 경로).
  keys?: readonly string[];
  timeoutMs?: number;
};

export type PreparationPool = {
  request(request: PoolRequest): Promise<Result<unknown, LophnError>>;
  // 한 번 쓰고 끝나는 worker. 읽기 권한이 요청마다 다른 일(아직 등록하지 않은 폴더 미리보기)이
  // 쓴다. spec의 권한만 가진 새 프로세스를 띄워 요청 하나를 보내고 끝낸다.
  requestOnce(
    spec: KindLaunchSpec,
    request: Pick<PoolRequest, "op" | "payload" | "timeoutMs">,
  ): Promise<Result<unknown, LophnError>>;
  // 띄운 worker를 모두 멈추고 이후 요청은 unavailable이다. root 권한이 바뀌면 core가
  // coordinator를 새로 띄우므로 pool을 다시 여는 일은 없다.
  stop(): Promise<void>;
};

export type PoolOptions = {
  // slot의 launch spec. 띄울 때 부르므로 그때의 root 권한을 따른다. 없으면 unavailable이다.
  specFor(slot: SlotName): KindLaunchSpec | undefined;
  // spec이 따르는 근거(등록 root)의 서명. 띄운 뒤 달라지면 다음 요청이 worker를 새 권한으로
  // 다시 띄운다(근거가 오기 전에 띄운 worker가 나중 root를 못 여는 일을 막는다).
  signature?(): string;
  denoCommand: string;
  env(kind: string): Record<string, string>;
  // 테스트가 감독을 바꿔 끼운다.
  createSupervisor?: typeof createSupervisor;
};

type Pending = (answer: Result<unknown, LophnError>) => void;

type Slot = {
  name: SlotName;
  supervisor?: Supervisor;
  starting?: Promise<boolean>;
  // 띄울 때의 근거 서명.
  signature?: string;
  busy: boolean;
  pending: Map<string, Pending>;
  channel: number;
  // 준비 worker가 응답 전에 보낸 byte chunk.
  inbox: ByteInbox;
};

type Waiter = {
  priority: SlotName;
  run(slot: Slot): void;
};

function unavailable(message: string): Result<never, LophnError> {
  return err({ code: "unavailable", message });
}

function helloFor(): ParentMessage {
  return {
    type: "hello",
    core_epoch: crypto.randomUUID(),
    process_identity: crypto.randomUUID(),
    kind: PREPARATION_KIND,
    task: "documents",
    scope: { operations: [], targets: {} },
    // 준비 worker는 core API를 부르지 않는다. 쓸 수 있는 credential이 아니다.
    credential: crypto.randomUUID(),
    api_port: 1,
  };
}

export function createPreparationPool(options: PoolOptions): PreparationPool {
  const make = options.createSupervisor ?? createSupervisor;
  const serializer = createFileSerializer();
  const slots: Slot[] = (["human", "background"] as const).map((name) => ({
    name,
    busy: false,
    pending: new Map(),
    channel: 0,
    inbox: createByteInbox(),
  }));
  const waiters: Waiter[] = [];
  let counter = 0;
  let stopped = false;

  function callbacks(
    pending: Map<string, Pending>,
    inbox?: ByteInbox,
  ): ChildCallbacks {
    return {
      onFrame(frame) {
        inbox?.collect(frame);
      },
      onMessage(message: ChildMessage) {
        if (message.type !== "worker_response") return;
        const settle = pending.get(message.request_id);
        if (!settle) return;
        pending.delete(message.request_id);
        settle(
          message.ok ? ok(message.payload) : err({
            code: message.error.code,
            message: "preparation worker rejected the request",
          }),
        );
      },
    };
  }

  function supervisorOptions() {
    return {
      clock: systemClock,
      denoCommand: options.denoCommand,
      env: options.env,
    };
  }

  // slot의 worker를 한 번만 띄운다. 실패하면 다음 요청이 다시 시도한다.
  function start(slot: Slot): Promise<boolean> {
    if (slot.starting !== undefined) return slot.starting;
    const spec = options.specFor(slot.name);
    if (spec === undefined) return Promise.resolve(false);
    const supervisor = make(supervisorOptions());
    slot.supervisor = supervisor;
    slot.signature = options.signature?.();
    slot.starting = supervisor.start(
      spec,
      helloFor(),
      callbacks(slot.pending, slot.inbox),
    )
      .then((started) => {
        if (!started.ok) {
          slot.starting = undefined;
          slot.supervisor = undefined;
          void supervisor.stopAll();
        }
        return started.ok;
      }, () => {
        slot.starting = undefined;
        slot.supervisor = undefined;
        return false;
      });
    return slot.starting;
  }

  async function send(
    supervisor: Supervisor,
    pending: Map<string, Pending>,
    channel: () => number,
    request: Pick<
      PoolRequest,
      "op" | "payload" | "bytes" | "timeoutMs" | "replyBytes"
    >,
    inbox?: ByteInbox,
  ): Promise<Result<unknown, LophnError>> {
    const id = `preparation-${++counter}`;
    let framed: number | undefined;
    if (request.bytes !== undefined) {
      framed = channel();
      for (let at = 0; at < request.bytes.length; at += BYTE_CHUNK) {
        const sent = await supervisor.sendBytes(
          PREPARATION_KIND,
          framed,
          request.bytes.subarray(at, at + BYTE_CHUNK),
        );
        if (!sent.ok) return unavailable("preparation worker is not ready");
      }
    }
    const replyChannel = request.replyBytes === true ? channel() : 0;
    const payload = typeof request.payload === "function"
      ? request.payload(framed ?? 0, replyChannel)
      : request.payload;
    const answered = new Promise<Result<unknown, LophnError>>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(unavailable("preparation worker did not answer in time"));
      }, request.timeoutMs ?? POOL_REQUEST_TIMEOUT_MS);
      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
    const sent = await supervisor.send(PREPARATION_KIND, {
      type: "worker_request",
      request_id: id,
      op: request.op,
      ...(framed === undefined ? {} : { channel: framed }),
      payload,
    });
    if (!sent.ok) {
      pending.delete(id);
      return unavailable("preparation worker is not ready");
    }
    const reply = await answered;
    if (request.replyBytes !== true || !reply.ok) return reply;
    // 바이트 frame은 응답보다 먼저 와 있다(같은 pipe의 순서).
    const length = (reply.value as { bytes?: unknown } | null)?.bytes;
    if (typeof length !== "number" || inbox === undefined) {
      return unavailable("preparation worker sent no bytes");
    }
    const taken = inbox.take(replyChannel, length);
    return taken.ok
      ? ok({ payload: reply.value, bytes: taken.value })
      : unavailable("preparation worker bytes did not arrive");
  }

  async function runOn(
    slot: Slot,
    request: PoolRequest,
  ): Promise<Result<unknown, LophnError>> {
    try {
      if (
        slot.starting !== undefined && options.signature !== undefined &&
        slot.signature !== options.signature()
      ) {
        const stale = slot.supervisor;
        slot.supervisor = undefined;
        slot.starting = undefined;
        await stale?.stopAll().catch(() => false);
      }
      if (!await start(slot) || slot.supervisor === undefined) {
        return unavailable("preparation worker is not available");
      }
      return await send(
        slot.supervisor,
        slot.pending,
        () => {
          slot.channel = slot.channel % 0xffffffff + 1;
          return slot.channel;
        },
        request,
        slot.inbox,
      );
    } catch {
      return unavailable("preparation worker failed");
    }
  }

  // slot이 비면 기다리던 요청에 넘긴다. human slot은 사람 요청을 먼저, background slot은
  // background 요청을 먼저 받고 없으면 사람 요청도 받는다(흘린다).
  function release(slot: Slot) {
    slot.busy = false;
    drain();
  }

  function take(slot: Slot): Waiter | undefined {
    const order: SlotName[] = slot.name === "human"
      ? ["human", "background"]
      : ["background", "human"];
    for (const priority of order) {
      const index = waiters.findIndex((waiter) => waiter.priority === priority);
      if (index >= 0) return waiters.splice(index, 1)[0];
    }
    return undefined;
  }

  function drain() {
    for (const slot of slots) {
      if (slot.busy) continue;
      const waiter = take(slot);
      if (waiter === undefined) continue;
      slot.busy = true;
      waiter.run(slot);
    }
  }

  function acquire(priority: SlotName): Promise<Slot> {
    return new Promise((resolve) => {
      waiters.push({ priority, run: resolve });
      drain();
    });
  }

  async function locked<T>(
    keys: readonly string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const nest = (index: number): Promise<T> =>
      index >= ordered.length
        ? work()
        : serializer.run(ordered[index], () => nest(index + 1));
    return await nest(0);
  }

  return {
    request(request) {
      if (stopped) return Promise.resolve(unavailable("pool stopped"));
      return locked(request.keys ?? [], async () => {
        const slot = await acquire(request.priority);
        try {
          return await runOn(slot, request);
        } finally {
          release(slot);
        }
      });
    },
    async requestOnce(spec, request) {
      if (stopped) return unavailable("pool stopped");
      const supervisor = make(supervisorOptions());
      const pending = new Map<string, Pending>();
      let channel = 0;
      try {
        const started = await supervisor.start(
          spec,
          helloFor(),
          callbacks(pending),
        );
        if (!started.ok) {
          return started.code === "invalid_input"
            ? err({ code: "invalid_input", message: "invalid worker request" })
            : unavailable("preparation worker is not available");
        }
        return await send(supervisor, pending, () => ++channel, request);
      } catch {
        return unavailable("preparation worker failed");
      } finally {
        await supervisor.stopAll().catch(() => false);
      }
    },
    async stop() {
      stopped = true;
      await Promise.all(slots.map(async (slot) => {
        const supervisor = slot.supervisor;
        slot.supervisor = undefined;
        slot.starting = undefined;
        for (const settle of slot.pending.values()) {
          settle(unavailable("pool stopped"));
        }
        slot.pending.clear();
        await supervisor?.stopAll().catch(() => false);
      }));
    },
  };
}
