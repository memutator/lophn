// 제품 core가 secret store를 여는 조립(platform#T19, documents Q17 (3)). ledger가 가리키는
// 현재 secret 참조의 값을 OS keychain adapter로 읽어 core 보호 메모리(held)에 알려진 값을
// 채우고, reader pool의 등록·회수 통로로 같은 값을 reader Worker의 보호 메모리에 넣는다.
// documents의 제품 redactor가 pattern 검출에 더해 이 값도 지운다(documents-redactor.ts).
//
// 지키는 것:
// - 값은 keychain과 이 module의 메모리(held)·reader Worker의 registry에만 있다. ledger·event·log·
//   오류·HTTP 응답에 값과 sealed_ref를 싣지 않는다.
// - 이름의 참조가 바뀌거나 사라지면 옛 값을 회수한다(다른 이름이 같은 값을 쥐고 있으면 남긴다).
// - 값을 읽지 못하는 동안(keychain 잠김·불가)은 registry가 "준비되지 않음"이다. reader가 알려진
//   값을 모른 채 원문을 내보내지 않게 redactor는 null로 답한다(fail-closed). 다시 읽을 때까지
//   backoff로 재시도한다. 참조가 하나도 없으면 keychain을 열지 않는다.
// - keychain이 없는 환경은 secret 기능만 unavailable이다. 파일 볼트·환경 변수 fallback은 없다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretChannel,
  openConnection,
  type Writer,
} from "../../packages/platform/ledger/mod.ts";
import {
  createLinuxSecretServiceAdapter,
  type KeychainAdapter,
  randomSealedRef,
  readSecretRefs,
  secretToolRunner,
  unavailableAdapter,
} from "../../packages/platform/secrets/mod.ts";

export type SecretStore = {
  // ledger의 현재 참조와 알려진 값을 맞춘다. 동시에 부르면 한 번 더 도는 것으로 합친다.
  // 끝났을 때 registry가 현재 참조와 같으면 ok, 그렇지 않으면 err(이후 재시도한다).
  sync(): Promise<Result<void>>;
  // timer를 멈추고 core 쪽 값을 비운다(JS 메모리의 완전한 지움은 보장하지 않는다).
  stop(): void;
};

export type SecretStoreDeps = {
  ledgerPath: string;
  // reader pool의 알려진 값 통로.
  channel: KnownSecretChannel;
  // keychain adapter. 참조가 있을 때 처음 한 번 만든다(참조가 없는 core는 부르지 않는다).
  keychain(): KeychainAdapter;
  retryMs?: number;
  maxRetryMs?: number;
};

// 제품 기본 keychain. Linux는 Secret Service, 그 밖은 아직 adapter가 없어 unavailable이다
// (macOS·Windows adapter는 platform#T49).
export function productKeychain(): KeychainAdapter {
  return Deno.build.os === "linux"
    ? createLinuxSecretServiceAdapter({
      runner: secretToolRunner(),
      randomRef: randomSealedRef,
    })
    : unavailableAdapter();
}

type Held = { sealedRef: string; value: string };

export function openSecretStore(deps: SecretStoreDeps): SecretStore {
  const initial = deps.retryMs ?? 2_000;
  const ceiling = deps.maxRetryMs ?? 30_000;
  // core 보호 메모리의 알려진 값. 이름마다 현재 참조와 읽은 값이다.
  const held = new Map<string, Held>();
  let keychain: KeychainAdapter | undefined;
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
    const opened = openConnection(deps.ledgerPath);
    if (!opened.ok) return opened;
    let refs;
    try {
      refs = readSecretRefs(opened.value.sql);
    } finally {
      opened.value.close();
    }
    if (!refs.ok) return refs;
    const current = new Map(refs.value.map((r) => [r.name, r.sealedRef]));

    // 참조가 바뀌었거나 사라진 이름의 옛 값은 회수 대상이다.
    const dropped = new Map<string, Held>();
    for (const [name, value] of held) {
      if (current.get(name) !== value.sealedRef) dropped.set(name, value);
    }
    // 새 참조의 값을 keychain에서 읽는다. 한 이름이라도 읽지 못하면 알려진 값이 완전하지
    // 않으므로 준비되지 않음으로 둔다.
    const loaded = new Map<string, Held>();
    let incomplete: Result<never> | undefined;
    for (const [name, sealedRef] of current) {
      if (held.get(name)?.sealedRef === sealedRef) continue;
      keychain ??= deps.keychain();
      const read = await keychain.load(sealedRef);
      if (!read.ok) {
        incomplete = err({
          code: "unavailable",
          message: "secret 값을 읽지 못했다",
        });
        continue;
      }
      loaded.set(name, {
        sealedRef,
        value: new TextDecoder().decode(read.value),
      });
    }

    const next = new Map(held);
    for (const name of dropped.keys()) next.delete(name);
    for (const [name, value] of loaded) next.set(name, value);
    const stillKnown = new Set([...next.values()].map((h) => h.value));
    const register = [...loaded.values()].map((h) => h.value);
    const revoke = [...dropped.values()].map((h) => h.value).filter((value) =>
      !stillKnown.has(value)
    );

    // 등록을 먼저 한다. 회수가 실패해도 새 값은 이미 알려져 있다.
    const registered = await deps.channel.register(register);
    if (!registered.ok) return registered;
    const revoked = await deps.channel.revoke(revoke);
    if (!revoked.ok) return revoked;
    held.clear();
    for (const [name, value] of next) held.set(name, value);
    if (incomplete !== undefined) return incomplete;
    return await deps.channel.setReady(true);
  }

  async function run(): Promise<Result<void>> {
    let last: Result<void> = ok(undefined);
    do {
      again = false;
      last = await once();
    } while (again && !stopped);
    if (!last.ok) {
      // 값을 다 읽지 못한 채로 두지 않는다: reader가 원문을 내보내지 않게 막고 다시 시도한다.
      await deps.channel.setReady(false);
      retry();
    } else {
      delay = initial;
    }
    return last;
  }

  function sync(): Promise<Result<void>> {
    if (stopped) {
      return Promise.resolve(err({
        code: "unavailable",
        message: "secret store가 닫혔다",
      }));
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
    sync,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      held.clear();
    },
  };
}

// SetSecret·RemoveSecret이 확정된 뒤 응답을 돌려주기 전에 알려진 값을 맞춘다. 확정을 되돌리지
// 않으므로 맞추지 못해도 command 결과는 그대로고(registry는 준비되지 않음이 되어 막힌다),
// 재시도가 이어서 맞춘다.
const SECRET_COMMANDS: ReadonlySet<string> = new Set([
  "SetSecret",
  "RemoveSecret",
]);

export function withSecretSync(
  writer: Writer,
  sync: () => Promise<unknown>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope: CommandEnvelope) {
      const result = await writer.command(ctx, envelope);
      if (result.ok && SECRET_COMMANDS.has(envelope.command)) await sync();
      return result;
    },
  };
}
