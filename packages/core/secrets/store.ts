// 제품 core가 secret store를 여는 조립. ledger가 가리키는
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
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretChannel,
  type KnownSecretMatch,
  openConnection,
  type Writer,
} from "../storage/ledger/mod.ts";
import { createKnownSecretRegistry } from "../../base/redaction/mod.ts";
import {
  type KeychainAdapter,
  productKeychain,
  readSecretRefs,
  type SecretRefSource,
} from "./mod.ts";

// 제품 기본 keychain(Linux Secret Service, 그 밖은 unavailable)은 packages/core/secrets가 낸다.
export { productKeychain };

type SecretStore = {
  // ledger의 현재 참조와 알려진 값을 맞춘다. 동시에 부르면 한 번 더 도는 것으로 합친다.
  // 끝났을 때 registry가 현재 참조와 같으면 ok, 그렇지 않으면 err(이후 재시도한다).
  sync(): Promise<Result<void>>;
  // 알려진 값과 일치하는 부분을 찾는 얼굴(core 프로세스의 안전화용). 값 목록·개수는 내보내지
  // 않는다. ready는 현재 참조의 값을 모두 읽어 등록했을 때만 true라서, 모르는 채로 원문을
  // 내보내는 안전화가 스스로 막는다(fail-closed).
  readonly known: KnownSecretMatch;
  // timer를 멈추고 core 쪽 값을 비운다(JS 메모리의 완전한 지움은 보장하지 않는다).
  stop(): void;
};

type SecretStoreDeps = {
  ledgerPath: string;
  // reader pool의 알려진 값 통로.
  channel: KnownSecretChannel;
  // keychain adapter. 참조가 있을 때 처음 한 번 만든다(참조가 없는 core는 부르지 않는다).
  keychain(): KeychainAdapter;
  // 다른 concern이 자기 ledger 표에 둔 secret 참조(provider credential 등). 값은 그 owner의
  // 참조로 같은 keychain에서 읽고 같은 등록·회수 통로로 넣는다.
  sources?: readonly SecretRefSource[];
  retryMs?: number;
  maxRetryMs?: number;
};

const OWNER_SEPARATOR = "\u0000";

type Held = { sealedRef: string; value: string };

export function openSecretStore(deps: SecretStoreDeps): SecretStore {
  const initial = deps.retryMs ?? 2_000;
  const ceiling = deps.maxRetryMs ?? 30_000;
  // core 보호 메모리의 알려진 값. 이름마다 현재 참조와 읽은 값이다.
  const held = new Map<string, Held>();
  // core 프로세스 안의 안전화(메시지 본문)가 쓰는 같은 값의 matcher.
  const coreKnown = createKnownSecretRegistry();
  let ready = false;
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
    // 같은 snapshot에서 platform의 참조와 다른 owner의 참조를 모두 읽는다. 키는 owner를 앞에
    // 붙여 owner 사이 이름이 겹쳐도 섞이지 않게 한다(밖으로 나가지 않는다).
    const current = new Map<string, string>();
    try {
      const refs = readSecretRefs(opened.value.sql);
      if (!refs.ok) return refs;
      for (const ref of refs.value) {
        current.set(`platform${OWNER_SEPARATOR}${ref.name}`, ref.sealedRef);
      }
      for (const source of deps.sources ?? []) {
        const owned = source.read(opened.value.sql);
        if (!owned.ok) return owned;
        for (const ref of owned.value) {
          current.set(
            `${source.owner}${OWNER_SEPARATOR}${ref.name}`,
            ref.sealedRef,
          );
        }
      }
    } finally {
      opened.value.close();
    }

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
      // 없는 항목은 읽을 값이 없다. 알려진 값이 새는 것이 아니라서 준비 상태를 막지 않고, 다음 맞춤에서
      // 다시 읽는다. 잠김·사용 불가는 값을 모르는 것이라 계속 막는다.
      if (!read.ok && read.error.code === "not_found") continue;
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

    // 등록을 먼저 한다. 회수가 실패해도 새 값은 이미 알려져 있다. core 쪽 matcher도 같은 순서다.
    coreKnown.register(register);
    const registered = await deps.channel.register(register);
    if (!registered.ok) return registered;
    coreKnown.revoke(revoke);
    const revoked = await deps.channel.revoke(revoke);
    if (!revoked.ok) return revoked;
    held.clear();
    for (const [name, value] of next) held.set(name, value);
    if (incomplete !== undefined) return incomplete;
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
      // 값을 다 읽지 못한 채로 두지 않는다: reader가 원문을 내보내지 않게 막고 다시 시도한다.
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
    known: {
      match: (text) => coreKnown.match(text),
      get ready() {
        return ready;
      },
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      held.clear();
      coreKnown.clear();
      ready = false;
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
  sources: readonly SecretRefSource[] = [],
): Writer {
  // 다른 owner의 참조를 바꾸는 command도 같다(provider credential 등록·교체 등).
  const commands = new Set<string>(SECRET_COMMANDS);
  for (const source of sources) {
    for (const name of source.commands) commands.add(name);
  }
  return {
    ...writer,
    async command(ctx, envelope: CommandEnvelope) {
      const result = await writer.command(ctx, envelope);
      if (result.ok && commands.has(envelope.command)) await sync();
      return result;
    },
  };
}
