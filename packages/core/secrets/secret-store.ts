// secret 파일 위의 저장소: 파일(file-store.ts)과 알려진 값(redaction 입력)을 같이 맞춘다.
// 시작할 때와 put·delete 뒤에 파일의 모든 값을 core 보호 메모리의 matcher와 reader pool 통로에
// 올리고 회수한다. 긴 값 먼저·겹침·65개 넘음 규칙은 base/redaction이 맡는다.
//
// 지키는 것:
// - 값을 읽지 못하는 동안 `known.ready`와 reader의 ready는 false라서 redactor가 막는다(fail-closed).
//   다시 맞출 때까지 backoff로 재시도한다.
// - put은 파일에 쓰기 전에 새 값을 먼저 등록한다. 값이 파일에 생긴 순간에는 이미 알려진 값이다.
//   쓰기가 실패하면 이어지는 맞춤이 그 값을 회수한다.
import { err, ok, type Result } from "../../base/mod.ts";
import { createKnownSecretRegistry } from "../../base/redaction/mod.ts";
import type {
  SecretStorePort,
  SecretValue,
} from "../../protocol/secrets/mod.ts";
import type {
  KnownSecretChannel,
  KnownSecretMatch,
} from "../storage/ledger/mod.ts";
import type { SecretFileStore } from "./file-store.ts";

export type SecretStore = SecretStorePort & {
  // 파일을 열고 알려진 값을 맞춘다. 시작 때 한 번 부른다. 못 열어도 막힌 채(fail-closed) 재시도한다.
  open(): Promise<Result<void>>;
  names(): Result<string[]>;
  // 파일의 현재 값과 알려진 값을 맞춘다. 동시에 부르면 한 번 더 도는 것으로 합친다.
  sync(): Promise<Result<void>>;
  readonly known: KnownSecretMatch;
  // 파일에 없는 값을 알려진 값으로 붙든다(agent에게 한 번 넣은 값). 파일에는 쓰지 않고, release할 때까지 sync가 회수하지 않는다.
  hold(values: readonly string[]): Promise<Result<void>>;
  release(values: readonly string[]): Promise<Result<void>>;
  // timer를 멈추고 core 쪽 값을 비운다(JS 메모리의 완전한 지움은 보장하지 않는다).
  stop(): void;
};

export function openSecretStore(deps: {
  file: SecretFileStore;
  // reader pool의 알려진 값 통로.
  channel: KnownSecretChannel;
  retryMs?: number;
  maxRetryMs?: number;
}): SecretStore {
  const initial = deps.retryMs ?? 2_000;
  const ceiling = deps.maxRetryMs ?? 30_000;
  const coreKnown = createKnownSecretRegistry();
  // 통로에 올린 값. 파일의 현재 값과 비교해 올리고 회수한다.
  const registered = new Set<string>();
  // 파일 밖에서 붙든 값. 파일의 값과 함께 알려진 값이다.
  const held = new Set<string>();
  let ready = false;
  let running: Promise<Result<void>> | undefined;
  let again = false;
  let stopped = false;
  let delay = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function retry() {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void sync();
    }, delay);
    delay = Math.min(delay * 2, ceiling);
  }

  async function once(): Promise<Result<void>> {
    const read = deps.file.values();
    if (!read.ok) return read;
    const current = new Set([...read.value, ...held]);
    const add = [...current].filter((value) => !registered.has(value));
    const drop = [...registered].filter((value) => !current.has(value));
    // 등록을 먼저 한다. 회수가 실패해도 새 값은 이미 알려져 있다.
    coreKnown.register(add);
    const registeredOk = await deps.channel.register(add);
    if (!registeredOk.ok) return registeredOk;
    for (const value of add) registered.add(value);
    coreKnown.revoke(drop);
    const revoked = await deps.channel.revoke(drop);
    if (!revoked.ok) return revoked;
    for (const value of drop) registered.delete(value);
    const readied = await deps.channel.setReady(true);
    if (readied.ok) ready = true;
    return readied;
  }

  async function run(): Promise<Result<void>> {
    let last: Result<void> = ok(undefined);
    do {
      again = false;
      last = await once();
    } while (again && !stopped);
    if (!last.ok) {
      // 값을 다 알지 못한 채로 두지 않는다: reader가 원문을 내보내지 않게 막고 다시 시도한다.
      ready = false;
      await deps.channel.setReady(false);
      retry();
    } else {
      delay = initial;
    }
    return last;
  }

  function sync(): Promise<Result<void>> {
    if (stopped) {
      return Promise.resolve(
        err({
          code: "unavailable",
          message: "secret 저장소가 닫혔다",
        }),
      );
    }
    if (running !== undefined) {
      again = true;
      return running;
    }
    const started = run().finally(() => {
      running = undefined;
    });
    running = started;
    return started;
  }

  return {
    async open() {
      const opened = await deps.file.open();
      const synced = await sync();
      return opened.ok ? synced : opened;
    },
    names: () => deps.file.names(),
    get: (name) => deps.file.get(name),
    sync,
    known: {
      match: (text) => coreKnown.match(text),
      prefixFrom: (text) => coreKnown.prefixFrom(text),
      get ready() {
        return ready;
      },
    },
    async put(name, value) {
      const text = decode(value);
      if (text === undefined) {
        return err({
          code: "invalid_input",
          message: "secret 값이 올바르지 않다",
        });
      }
      // 파일에 쓰기 전에 알려진 값으로 올린다. 올리지 못하면 쓰지 않는다.
      coreKnown.register([text]);
      const early = await deps.channel.register([text]);
      if (!early.ok) return early;
      registered.add(text);
      const written = await deps.file.put(name, text);
      // 성공이든 실패든 맞춘다: 실패했으면 쓰이지 않은 값이 여기서 회수된다. 맞추지 못해도 쓰기 결과는
      // 그대로고, ready가 false라서 막히며 재시도가 이어서 맞춘다.
      await sync();
      return written;
    },
    hold(values) {
      for (const value of values) held.add(value);
      return sync();
    },
    release(values) {
      for (const value of values) held.delete(value);
      return sync();
    },
    async delete(name) {
      const deleted = await deps.file.delete(name);
      await sync();
      return deleted;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      registered.clear();
      held.clear();
      coreKnown.clear();
      ready = false;
      deps.file.stop();
    },
  };
}

function decode(value: SecretValue): string | undefined {
  if (typeof value === "string") return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return undefined;
  }
}
