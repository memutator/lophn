// link로 나르기: 붙은 컴퓨터마다 상대가 든 manifest와 file 가운데 이 컴퓨터에 없는 것을 가져와(pull) `computers` 폴더의 받는
// 자리(`FolderReplica`)에 넘긴다. 상대가 다른 기계의 file을 들고 있으면 그것도 받아 늘 켜 둔 기계가 저절로 가운데가 된다.
// 받는 쪽 검사(서명, 목록 사슬, 크기·sha256)는 받는 자리가 한다. 여기서는 검증하거나 쓰지 않는다.
// 컴퓨터마다 한 번에 하나다. 계기는 link가 붙음, 상대의 `StateChanged{carry_files}`(2초 debounce), 이 기계의
// `StateChanged{carry_files}`(새로 믿게 된 manifest가 상대에게 있는 file을 바랄 수 있다), 5분 timer다. 실패하면 1분부터
// 두 배씩 1시간까지 물러난다. timer는 idle-exit를 막지 않는다(`wait`이 unref한다).
import {
  type Clock,
  err,
  type LophnError,
  type Logger,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  CARRY_CHUNK_MAX_BYTES,
  CARRY_WANTS_MAX,
  carryFile,
  carryManifests,
  manifestPath,
} from "../../protocol/remote/carry.ts";
import {
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
} from "../../protocol/folder/limits.ts";
import type { FolderReplica } from "../folder/ports.ts";

const SECOND = 1000;
const PEER_DEBOUNCE_MS = 2 * SECOND;
const TIMER_MS = 5 * 60 * SECOND;
// 공개 relay(Fly)는 짝마다 초당 1 MiB, 한꺼번에 17 MiB, 받는 쪽 밀림 1 MiB를 넘으면 짝을 닫는다(`relay-room.ts`). 그 길로는
// 조각을 줄이고 조각 사이를 쉬어 base64와 Noise 덧붙임을 더해도 한도 안에 든다. 64 MiB file 하나가 2분쯤 걸린다.
const PUBLIC_RELAY_CHUNK_BYTES = 512 * 1024;
const PUBLIC_RELAY_GAP_MS = SECOND;

// 한 pass에서 조각을 몇 byte씩 받고 조각 사이를 얼마나 쉬는가.
export type CarryPace = { chunk: number; pause(): Promise<void> };
const FULL_SPEED: CarryPace = {
  chunk: CARRY_CHUNK_MAX_BYTES,
  pause: () => Promise.resolve(),
};

// 한 pass가 한 일. 관측용으로 log에 남긴다.
export type CarryPass = {
  more: boolean;
  // 새로 받아 들인 manifest 수.
  manifests: number;
  // 이 컴퓨터가 바란 file 수, 받아 들인 수, 상대가 들고 있지 않은 수, 받는 자리가 믿지 않은 수.
  wanted: number;
  received: number;
  missing: number;
  rejected: number;
};

// 한 상대에게 route 하나를 부른다(link의 `call`). 답에는 type이 없다.
export type PeerCall = (
  resource: string,
  method: string,
  body: unknown,
) => Promise<Result<unknown>>;

type Carried = { machine: Id<"mch">; path: string; size: number };

async function readChunk(
  call: PeerCall,
  file: Carried,
  offset: number,
  pace: CarryPace,
): Promise<Result<Uint8Array>> {
  const got = await call(carryFile.resource, carryFile.method, {
    machine: file.machine,
    path: file.path,
    offset,
    length: Math.min(pace.chunk, file.size - offset),
  });
  if (!got.ok) return got;
  const { base64 } = got.value as { base64: string };
  return ok(new Uint8Array(Buffer.from(base64, "base64")));
}

// 상대의 file 하나를 offset 순서의 조각으로 연다. 상대가 들고 있지 않으면(첫 조각이 not_found) null이다. 뒤 조각이 실패하면
// 조각이 거기서 끝나고(받는 자리는 크기가 모자라 받지 않는다) `failure`가 그 오류다.
async function openFile(
  call: PeerCall,
  file: Carried,
  pace: CarryPace,
  start = 0,
): Promise<
  Result<{
    chunks: AsyncIterable<Uint8Array>;
    failure(): LophnError | undefined;
  } | null>
> {
  let first: Uint8Array = new Uint8Array();
  if (file.size > start) {
    const read = await readChunk(call, file, start, pace);
    if (!read.ok) return read.error.code === "not_found" ? ok(null) : read;
    first = read.value;
  }
  let failure: LophnError | undefined;
  async function* chunks() {
    let bytes = first;
    let offset = start;
    while (bytes.byteLength > 0) {
      yield bytes;
      offset += bytes.byteLength;
      if (offset >= file.size) return;
      await pace.pause();
      const next = await readChunk(call, file, offset, pace);
      if (!next.ok) {
        failure = next.error;
        return;
      }
      bytes = next.value;
    }
  }
  return ok({ chunks: chunks(), failure: () => failure });
}

// 뒤 조각의 not_found는 그 사이 상대가 file을 놓은 것이라 건너뛴다.
const failed = (failure: LophnError | undefined) =>
  failure !== undefined && failure.code !== "not_found";

/**
 * 한 상대에게서 한 번 받는다. 상대의 manifest 가운데 이 기계가 든 revision보다 새 것의 글을 받아 `offerManifest`에 넘기고,
 * `wants`를 cursor로 빈 page까지 넘기며 file마다 상대의 조각을 `receive` 하나에 흘린다. 상대가 들고 있지 않은 file은
 * 건너뛴다. 상대가 `carry/manifests`에 not_found로 답하면(나르기를 모르는 옛 lophn) 아무것도 하지 않는다. `more`는 이번에
 * 받아 들인 것이 있다는 뜻이다: 새로 든 목록 file이 이번 cursor 앞의 file을 덮을 수 있어 한 번 더 돈다.
 * `rejected`는 기계마다 받는 자리가 믿지 않은 manifest의 sha256이다. 같은 글은 다시 받지 않는다(pass를 넘어 든다).
 */
export async function carryFrom(
  call: PeerCall,
  replica: FolderReplica,
  rejected: Map<string, string>,
  pace: CarryPace = FULL_SPEED,
): Promise<Result<CarryPass>> {
  const pass: CarryPass = {
    more: false,
    manifests: 0,
    wanted: 0,
    received: 0,
    missing: 0,
    rejected: 0,
  };
  const listed = await call(carryManifests.resource, carryManifests.method, {});
  if (!listed.ok) {
    return listed.error.code === "not_found" ? ok(pass) : listed;
  }
  const held = await replica.manifests();
  if (!held.ok) return held;
  const revisions = new Map<string, number>(
    held.value.map((each) => [each.machine, each.revision]),
  );
  const { manifests } = listed.value as {
    manifests: {
      machine: Id<"mch">;
      revision: number;
      size: number;
      sha256: string;
    }[];
  };
  for (const each of manifests) {
    if (each.revision <= (revisions.get(each.machine) ?? 0)) continue;
    if (rejected.get(each.machine) === each.sha256) continue;
    const opened = await openFile(
      call,
      {
        machine: each.machine,
        path: manifestPath(each.machine),
        size: each.size,
      },
      pace,
    );
    if (!opened.ok) return opened;
    if (opened.value === null) continue;
    const parts: Uint8Array[] = [];
    for await (const chunk of opened.value.chunks) parts.push(chunk);
    const failure = opened.value.failure();
    if (failed(failure)) return err(failure!);
    if (failure !== undefined) continue;
    const offered = await replica.offerManifest(
      new TextDecoder().decode(Buffer.concat(parts)),
      "link",
    );
    if (!offered.ok) return offered;
    if (offered.value === "rejected") rejected.set(each.machine, each.sha256);
    else rejected.delete(each.machine);
    if (offered.value === "accepted") {
      pass.more = true;
      pass.manifests += 1;
    }
  }
  let after: { machine: Id<"mch">; path: string } | undefined;
  for (;;) {
    const page = await replica.wants(CARRY_WANTS_MAX, after);
    if (!page.ok) return page;
    const last = page.value.at(-1);
    if (last === undefined) return ok(pass);
    for (const want of page.value) {
      pass.wanted += 1;
      // 앞서 받다 끊긴 만큼 뒤부터 받는다. 다른 상대에게서 지금 받고 있으면 이번에는 건너뛴다.
      const start = await replica.received(want);
      if (start === null) continue;
      const opened = await openFile(call, want, pace, start);
      if (!opened.ok) return opened;
      if (opened.value === null) {
        pass.missing += 1;
        continue;
      }
      const received = await replica.receive({
        ...want,
        via: "link",
        chunks: opened.value.chunks,
        offset: start,
      });
      const failure = opened.value.failure();
      if (failed(failure)) return err(failure!);
      if (!received.ok) return received;
      if (received.value === "accepted") {
        pass.more = true;
        pass.received += 1;
      } else if (received.value === "rejected") pass.rejected += 1;
    }
    after = { machine: last.machine, path: last.path };
  }
}

export type CarryLinksDeps = {
  call(machine: Id<"mch">, ...rest: Parameters<PeerCall>): ReturnType<PeerCall>;
  // link가 붙은 컴퓨터의 기계 id.
  peers(): Id<"mch">[];
  // 받는 자리. 아직 없으면(folder가 내지 않았다) 다음 계기로 미룬다.
  replica(): FolderReplica | undefined;
  // 그 컴퓨터와의 link가 공개 relay를 거친다(속도를 맞춘다).
  throughPublicRelay(machine: Id<"mch">): boolean;
  clock: Clock;
  // ms 뒤에 fn을 부른다(idle-exit를 막지 않게). 취소 함수를 돌려준다.
  wait(ms: number, fn: () => void): () => void;
  logger: Logger;
};

type Lane = {
  running: boolean;
  again: boolean;
  woken: boolean;
  attempts: number;
  notBefore: number;
};

export type CarryLinks = ReturnType<typeof createCarryLinks>;

/** remote가 켜질 때 `start`, 꺼질 때 `stop`. 그 사이의 계기를 컴퓨터마다 한 번에 하나인 받기로 바꾼다. */
export function createCarryLinks(deps: CarryLinksDeps) {
  const lanes = new Map<string, Lane>();
  const debounces = new Map<string, () => void>();
  // 기계마다 받는 자리가 믿지 않은 manifest의 sha256(상대를 가리지 않는다). 명단 view가 바뀌면 믿게 될 수 있어 비운다.
  const rejected = new Map<string, string>();
  let cancelTimer: (() => void) | undefined;
  let active = false;

  function kick(machine: Id<"mch">) {
    if (!active) return;
    let lane = lanes.get(machine);
    if (lane === undefined) {
      lane = {
        running: false,
        again: false,
        woken: false,
        attempts: 0,
        notBefore: 0,
      };
      lanes.set(machine, lane);
    }
    const one = lane;
    if (one.running) {
      one.again = true;
      return;
    }
    if (deps.clock.nowMs() < one.notBefore) return;
    const replica = deps.replica();
    if (replica === undefined) return;
    one.running = true;
    const call: PeerCall = (...rest) => deps.call(machine, ...rest);
    void (async () => {
      try {
        for (;;) {
          one.again = false;
          one.woken = false;
          const paced = deps.throughPublicRelay(machine);
          const pace: CarryPace = paced
            ? {
                chunk: PUBLIC_RELAY_CHUNK_BYTES,
                pause: () =>
                  new Promise((resolve) => {
                    deps.wait(PUBLIC_RELAY_GAP_MS, resolve);
                  }),
              }
            : FULL_SPEED;
          let done: Result<CarryPass>;
          try {
            done = await carryFrom(call, replica, rejected, pace);
          } catch (thrown) {
            done = err({
              code: "internal",
              message:
                thrown instanceof Error ? thrown.message : String(thrown),
            });
          }
          if (!done.ok) {
            deps.logger.warn({
              component: "remote",
              event: "link_carry_failed",
              fields: {
                machine,
                code: done.error.code,
                message: done.error.message,
              },
            });
            // 이전 연결 실패가 도는 사이 새 연결이 ready로 깨웠으면 물러나지 않고 바로 다시 받는다.
            if (one.woken && active) {
              one.woken = false;
              continue;
            }
            one.notBefore =
              deps.clock.nowMs() +
              Math.min(
                BACKOFF_FIRST_MS * 2 ** Math.min(one.attempts, 20),
                BACKOFF_MAX_MS,
              );
            one.attempts += 1;
            return;
          }
          one.attempts = 0;
          one.notBefore = 0;
          const pass = done.value;
          if (pass.manifests > 0 || pass.wanted > 0) {
            deps.logger.info({
              component: "remote",
              event: "link_carry_pass",
              fields: {
                machine,
                paced,
                manifests: pass.manifests,
                wanted: pass.wanted,
                received: pass.received,
                missing: pass.missing,
                rejected: pass.rejected,
              },
            });
          }
          if (!active || !(done.value.more || one.again)) return;
        }
      } finally {
        one.running = false;
      }
    })();
  }

  function debounce(name: string, fn: () => void) {
    debounces.get(name)?.();
    debounces.set(
      name,
      deps.wait(PEER_DEBOUNCE_MS, () => {
        debounces.delete(name);
        fn();
      }),
    );
  }

  function all() {
    for (const machine of deps.peers()) kick(machine);
  }

  function tick() {
    cancelTimer = deps.wait(TIMER_MS, () => {
      all();
      tick();
    });
  }

  return {
    start() {
      if (active) return;
      active = true;
      // 꺼지는 사이 끊긴 link로 실패한 물러남은 다시 켤 때 지운다.
      for (const lane of lanes.values()) {
        lane.attempts = 0;
        lane.notBefore = 0;
      }
      tick();
    },
    stop() {
      active = false;
      cancelTimer?.();
      cancelTimer = undefined;
      for (const cancel of debounces.values()) cancel();
      debounces.clear();
    },
    // link가 붙었다. 앞 연결에서 실패해 남은 물러남은 새 연결에서 바로 지우고 받는다.
    ready(machine: Id<"mch">) {
      const lane = lanes.get(machine);
      if (lane !== undefined) {
        lane.attempts = 0;
        lane.notBefore = 0;
        if (lane.running) lane.woken = true;
      }
      kick(machine);
    },
    // 상대가 든 옮기는 file이 바뀌었다.
    peerChanged(machine: Id<"mch">) {
      debounce(machine, () => kick(machine));
    },
    // 명단이 바뀌었다. 믿지 않던 manifest를 이제 믿을 수 있다.
    rosterChanged() {
      rejected.clear();
    },
    // 이 기계가 든 manifest가 바뀌었다.
    changed() {
      debounce("", all);
    },
  };
}
