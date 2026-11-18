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
): Promise<Result<Uint8Array>> {
  const got = await call(carryFile.resource, carryFile.method, {
    machine: file.machine,
    path: file.path,
    offset,
    length: Math.min(CARRY_CHUNK_MAX_BYTES, file.size - offset),
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
): Promise<
  Result<{
    chunks: AsyncIterable<Uint8Array>;
    failure(): LophnError | undefined;
  } | null>
> {
  let first: Uint8Array = new Uint8Array();
  if (file.size > 0) {
    const read = await readChunk(call, file, 0);
    if (!read.ok) return read.error.code === "not_found" ? ok(null) : read;
    first = read.value;
  }
  let failure: LophnError | undefined;
  async function* chunks() {
    let bytes = first;
    let offset = 0;
    while (bytes.byteLength > 0) {
      yield bytes;
      offset += bytes.byteLength;
      if (offset >= file.size) return;
      const next = await readChunk(call, file, offset);
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
): Promise<Result<{ more: boolean }>> {
  const listed = await call(carryManifests.resource, carryManifests.method, {});
  if (!listed.ok) {
    return listed.error.code === "not_found" ? ok({ more: false }) : listed;
  }
  const held = await replica.manifests();
  if (!held.ok) return held;
  const revisions = new Map<string, number>(
    held.value.map((each) => [each.machine, each.revision]),
  );
  let more = false;
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
    const opened = await openFile(call, {
      machine: each.machine,
      path: manifestPath(each.machine),
      size: each.size,
    });
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
    if (offered.value === "accepted") more = true;
  }
  let after: { machine: Id<"mch">; path: string } | undefined;
  for (;;) {
    const page = await replica.wants(CARRY_WANTS_MAX, after);
    if (!page.ok) return page;
    const last = page.value.at(-1);
    if (last === undefined) return ok({ more });
    for (const want of page.value) {
      const opened = await openFile(call, want);
      if (!opened.ok) return opened;
      if (opened.value === null) continue;
      const received = await replica.receive({
        ...want,
        via: "link",
        chunks: opened.value.chunks,
      });
      const failure = opened.value.failure();
      if (failed(failure)) return err(failure!);
      if (!received.ok) return received;
      if (received.value === "accepted") more = true;
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
  clock: Clock;
  // ms 뒤에 fn을 부른다(idle-exit를 막지 않게). 취소 함수를 돌려준다.
  wait(ms: number, fn: () => void): () => void;
  logger: Logger;
};

type Lane = {
  running: boolean;
  again: boolean;
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
      lane = { running: false, again: false, attempts: 0, notBefore: 0 };
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
          let done: Result<{ more: boolean }>;
          try {
            done = await carryFrom(call, replica, rejected);
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
    // link가 붙었다.
    ready: kick,
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
