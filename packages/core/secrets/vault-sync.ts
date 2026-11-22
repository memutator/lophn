// browser vault를 명단의 다른 컴퓨터와 맞춘다. 길은 컴퓨터 사이 link 하나다(Noise로 두 core 사이에서 암호화된다). 폴더, 폰,
// relay가 읽을 수 있는 곳에는 아무것도 쓰지 않는다.
//
// - 받기(pull)만 있다. 이 컴퓨터는 link가 붙은 컴퓨터마다 그 컴퓨터의 `browser_vault/exchange`를 불러 받은 vault(값 포함)를
//   자기 vault에 합친다. 상대도 같은 일을 하므로 늘 켜 둔 컴퓨터가 저절로 가운데가 되어 A의 것이 B를 거쳐 C에 간다.
// - 계기: link가 붙음, 상대의 `StateChanged{logins|browser_profiles}`(2초 debounce), 5분 timer, 이 컴퓨터의 나누기를 켬.
//   실패는 1분부터 두 배씩 1시간까지 물러난다. 상대가 나누기를 껐거나(forbidden) 옛 판(not_found)이면 물러나지 않고 조용히
//   다음 계기(상대의 바뀜, 5분 timer)를 기다린다.
// - 나누기를 끈 컴퓨터는 받지도 내주지도 않는다.
// - 값을 못 읽으면(secret store가 unavailable) 내주지도 합치지도 않는다. 못 읽은 값을 "없음"으로 보내면 상대가 그 값을 지운다.
// - 합친 값은 secret store의 put으로 쓴다(file에 쓰기 전에 알려진 값으로 올린다). 값은 ledger, log, event, 오류에 없다.
// - 합치기는 사람의 login 값 쓰기(그 칸 stamp 올리기까지)와 한 줄로 돈다(secrets wiring의 queue).
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
  LOGIN_VALUE_FIELDS,
  loginSecretName,
  type VaultFile,
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

// vault의 login 값을 다 읽는다. 없는 값(not_found)만 null이고 다른 실패는 unavailable이다.
function readValues(
  secrets: Pick<Secrets, "get">,
  vault: VaultFile,
): Result<(id: string) => LoginValues> {
  const values = new Map<string, LoginValues>();
  for (const login of vault.logins) {
    const one: LoginValues = { password: null, totp: null };
    for (const field of LOGIN_VALUE_FIELDS) {
      const got = secrets.get(loginSecretName(login.id, field));
      if (got.ok) one[field] = got.value;
      else if (got.error.code !== "not_found") {
        return err({
          code: "unavailable",
          message: "saved login values cannot be read",
        });
      }
    }
    values.set(login.id, one);
  }
  return ok((id) => values.get(id) ?? { password: null, totp: null });
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
    const values = readValues(deps.secrets, read.value);
    if (!values.ok) return values;
    return ok(stateOf(read.value, values.value));
  };
  return handler;
}

/**
 * 받은 vault를 이 컴퓨터에 합친다. 값을 먼저 쓰고, 합친 vault를 쓴 뒤, 흔적이 있는 login의 값을 지운다(중간에 끊겨도 다시
 * 합치면 같은 결과다). 바뀌었으면 true다. 이 컴퓨터의 값을 못 읽으면 아무것도 쓰지 않고 unavailable이다. 부르는 쪽이 login
 * 값 쓰기와 한 줄로 부른다.
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
    const values = readValues(deps.secrets, read.value);
    if (!values.ok) return values;
    const plan = planMerge(read.value, values.value, remote.data);
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
    // 흔적이 있는 login의 값만 지운다(이번에 지워진 것과 끊긴 앞 합치기가 남긴 것). vault에 없다는 것만으로는 지우지 않는다:
    // vault file이 없거나 비면 빈 vault로 읽혀 모든 login 값이 지워진다.
    const gone = new Set(plan.vault.removed.map((one) => one.id));
    const names = deps.secrets.names();
    if (!names.ok) return names;
    for (const name of names.value) {
      if (!name.startsWith(LOGIN_SECRET_PREFIX)) continue;
      const id = name.slice(LOGIN_SECRET_PREFIX.length).split(".")[0]!;
      if (!gone.has(id)) continue;
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
  // 받은 답을 이 컴퓨터에 합친다(applyRemoteVault를 login 값 쓰기와 한 줄로).
  merge(answer: unknown): Promise<Result<boolean>>;
  // 그 컴퓨터의 `browser_vault/exchange`를 link로 부른다.
  exchange(machine: Id<"mch">): Promise<Result<unknown>>;
  // link가 붙은 컴퓨터의 기계 id.
  peers(): Id<"mch">[];
  // 그 기계가 지금 명단의 컴퓨터인가.
  inRoster(machine: Id<"mch">): boolean;
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
    // 받는 사이 나누기를 껐거나 그 컴퓨터가 명단에서 빠졌으면 합치지 않는다.
    if (!deps.sharing() || !deps.inRoster(machine)) return ok(false);
    return await deps.merge(answer.value);
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
