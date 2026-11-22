// browser vault를 명단의 다른 컴퓨터와 맞춘다. 길은 컴퓨터 사이 link 하나다(Noise로 두 core 사이에서 암호화된다). 폴더, 폰,
// relay가 읽을 수 있는 곳에는 아무것도 쓰지 않는다.
//
// - 받기(pull)만 있다. 이 컴퓨터는 link가 붙은 컴퓨터마다 그 컴퓨터의 `browser_vault/exchange`를 불러 받은 vault(값 포함)를
//   자기 vault에 합친다. 상대도 같은 일을 하므로 늘 켜 둔 컴퓨터가 저절로 가운데가 되어 A의 것이 B를 거쳐 C에 간다.
// - 계기: link가 붙음, 상대의 `StateChanged{logins|browser_profiles}`(2초 debounce), 5분 timer, 이 컴퓨터의 나누기를 켬.
//   실패는 1분부터 두 배씩 1시간까지 물러난다. 상대가 나누기를 껐거나(forbidden) 옛 판(not_found)이면 물러나지 않고 조용히
//   다음 계기를 기다린다(상대가 바꿀 때마다 한 번씩만 묻는다).
// - 나누기를 끈 컴퓨터는 받지도 내주지도 않는다.
// - 합친 값은 secret store의 put으로 쓴다(file에 쓰기 전에 알려진 값으로 올린다). 값은 ledger, log, event, 오류에 없다.
import {
  type Clock,
  err,
  type Logger,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
} from "../../protocol/folder/limits.ts";
import {
  browserVaultExchange,
  LOGIN_SECRET_PREFIX,
  loginSecretName,
} from "../../protocol/secrets/mod.ts";
import type { MemoryHandler } from "../server/mod.ts";
import type { BrowserVault } from "./browser-vault.ts";
import type { SecretStore } from "./secret-store.ts";
import { type LoginValues, planMerge, stateOf } from "./vault-merge.ts";

const SECOND = 1000;
const PEER_DEBOUNCE_MS = 2 * SECOND;
const TIMER_MS = 5 * 60 * SECOND;
// 합치는 사이 사람이 vault를 바꾸면 다시 합친다. 그래도 맞지 않으면 다음 계기에 한다.
const MERGE_ATTEMPTS = 3;

type Secrets = Pick<SecretStore, "get" | "put" | "delete" | "names">;

function valuesOf(secrets: Pick<Secrets, "get">) {
  return (id: string): LoginValues => {
    const read = (field: "password" | "totp") => {
      const got = secrets.get(loginSecretName(id, field));
      return got.ok ? got.value : null;
    };
    return { password: read("password"), totp: read("totp") };
  };
}

/**
 * `browser_vault/exchange`. 부른 쪽이 지금 명단의 컴퓨터(기기 자격, kind computer)일 때만 vault와 값을 낸다. 요청한 쪽(`by`)이 있는
 * call과 폰은 기기 입구(core/remote/call.ts)가 먼저 막는다. 이 컴퓨터의 사람 token, agent, CLI는 기기가 아니라 막힌다.
 */
export function browserVaultExchangeHandler(deps: {
  vault: BrowserVault;
  secrets: Pick<Secrets, "get">;
  // 그 principal이 지금 명단의 컴퓨터인가. 빠진 컴퓨터는 false다.
  isComputer(principal: string): boolean;
  sharing(): boolean;
}) {
  const handler: MemoryHandler = (ctx, rawInput) => {
    if (
      !ctx.principal.startsWith("device:") ||
      !deps.isComputer(ctx.principal)
    ) {
      return err({
        code: "forbidden",
        message: "only the lophn of a paired computer reaches this",
      });
    }
    if (!deps.sharing()) {
      return err({
        code: "forbidden",
        message: "this computer does not share browser profiles and logins",
      });
    }
    const input = browserVaultExchange.input.safeParse(rawInput);
    if (!input.success) {
      return err({ code: "invalid_input", message: "no input is taken" });
    }
    const read = deps.vault.read();
    if (!read.ok) return read;
    return ok(stateOf(read.value, valuesOf(deps.secrets)));
  };
  return handler;
}

/**
 * 받은 vault를 이 컴퓨터에 합친다. 값을 먼저 쓰고, 합친 vault를 쓴 뒤, 지워진 login과 vault에 없는 login의 값을 지운다
 * (중간에 끊겨도 다시 합치면 같은 결과다). 바뀌었으면 true다.
 */
export async function applyRemoteVault(
  deps: { vault: BrowserVault; secrets: Secrets },
  answer: unknown,
): Promise<Result<boolean>> {
  const remote = browserVaultExchange.output.safeParse(answer);
  if (!remote.success) {
    return err({
      code: "invalid_input",
      message: "the other computer sent a browser vault of the wrong shape",
    });
  }
  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
    const read = deps.vault.read();
    if (!read.ok) return read;
    const plan = planMerge(read.value, valuesOf(deps.secrets), remote.data);
    for (const one of plan.values) {
      const name = loginSecretName(one.id, one.field);
      const written =
        one.value === null
          ? await deps.secrets.delete(name)
          : await deps.secrets.put(name, one.value);
      if (!written.ok) return written;
    }
    const replaced = plan.changed
      ? deps.vault.replace(read.value, plan.vault)
      : ok(true);
    if (!replaced.ok) return replaced;
    if (!replaced.value) continue;
    // 지워진 login의 값과, 끊긴 앞 합치기가 남긴 vault 밖 login의 값을 지운다. 지우는 사이 사람이 막 저장한 login(vault에 먼저
    // 들고 값이 뒤에 온다)을 지우지 않게 이름마다 지금 vault를 본다.
    const names = deps.secrets.names();
    if (!names.ok) return names;
    for (const name of names.value) {
      if (!name.startsWith(LOGIN_SECRET_PREFIX)) continue;
      const id = name.slice(LOGIN_SECRET_PREFIX.length).split(".")[0]!;
      const now = deps.vault.read();
      if (!now.ok) return now;
      if (now.value.logins.some((login) => login.id === id)) continue;
      const deleted = await deps.secrets.delete(name);
      if (!deleted.ok) return deleted;
    }
    return ok(plan.changed || plan.values.length > 0);
  }
  return err({
    code: "conflict",
    message: "the browser vault kept changing while merging",
  });
}

export type VaultSyncDeps = {
  vault: BrowserVault;
  secrets: Secrets;
  // 그 컴퓨터의 `browser_vault/exchange`를 link로 부른다.
  exchange(machine: Id<"mch">): Promise<Result<unknown>>;
  // link가 붙은 컴퓨터의 기계 id.
  peers(): Id<"mch">[];
  sharing(): boolean;
  // 합쳐서 바뀌었다. 화면과 shell main, 다른 컴퓨터가 다시 읽게 알린다.
  changed(): void;
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

export type VaultSync = ReturnType<typeof createVaultSync>;

/** remote가 켜질 때 `start`, 꺼질 때 `stop`. 계기를 컴퓨터마다 한 번에 하나인 받기로 바꾼다. */
export function createVaultSync(deps: VaultSyncDeps) {
  const lanes = new Map<string, Lane>();
  const debounces = new Map<string, () => void>();
  let cancelTimer: (() => void) | undefined;
  let active = false;

  function kick(machine: Id<"mch">) {
    if (!active || !deps.sharing()) return;
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
    one.running = true;
    void (async () => {
      try {
        for (;;) {
          one.again = false;
          const done = await pullFrom(machine).catch(
            (thrown: unknown): Result<boolean> =>
              err({
                code: "internal",
                message:
                  thrown instanceof Error ? thrown.message : String(thrown),
              }),
          );
          if (!done.ok) {
            // 나누기를 끈 컴퓨터와 이 route를 모르는 옛 판은 실패가 아니다.
            if (
              done.error.code === "forbidden" ||
              done.error.code === "not_found"
            ) {
              return;
            }
            deps.logger.warn({
              component: "secrets",
              event: "browser_vault_sync_failed",
              fields: { machine, code: done.error.code },
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
          if (done.value) deps.changed();
          if (!active || !one.again) return;
        }
      } finally {
        one.running = false;
      }
    })();
  }

  async function pullFrom(machine: Id<"mch">): Promise<Result<boolean>> {
    const answer = await deps.exchange(machine);
    if (!answer.ok) return answer;
    // 받는 사이 나누기를 껐으면 합치지 않는다.
    if (!deps.sharing()) return ok(false);
    return await applyRemoteVault(deps, answer.value);
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
    // 상대의 profile이나 login이 바뀌었다.
    peerChanged(machine: Id<"mch">) {
      debounces.get(machine)?.();
      debounces.set(
        machine,
        deps.wait(PEER_DEBOUNCE_MS, () => {
          debounces.delete(machine);
          kick(machine);
        }),
      );
    },
    // 이 컴퓨터가 나누기를 켰다.
    sharingChanged: all,
  };
}
