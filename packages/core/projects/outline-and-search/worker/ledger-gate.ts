// derived store가 지금 ledger의 것인지 확인하는 문(platform#T42, platform/backup-and-migration#R14).
// ledger를 새로 만들거나 backup에서 복원하면 `/v1/platform/status`의 `ledger_id`가 바뀌고, 그때
// store가 옛 ledger의 seq를 가리키는 cursor를 쥐고 있으면 복원 ledger의 같은 숫자 seq를 건너뛴다.
// coordinator는 hello 뒤 machine credential로 core의 식별을 읽어 store를 맞추고, 맞출 때까지 search
// consumer 요청(cursor·apply·advance)은 기다린다. 읽지 못하면 일정 간격으로 다시 시도하고 그동안
// 요청은 unavailable이다: 옛 cursor로 받지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import type { DerivedStore } from "../adapters/store.ts";
import { reconcileLedgerBasis } from "../ledger-basis.ts";

export type LedgerGate = {
  // store가 현재 ledger에 맞춰졌으면 ok. 기한 안에 맞추지 못하면 unavailable이다.
  ready(): Promise<Result<void>>;
  // core의 ledger 식별을 읽는 함수를 받아 맞추기를 시작한다. 한 번만 시작한다.
  attach(read: () => Promise<Result<string, LophnError>>): void;
  stop(): void;
};

export type LedgerGateOptions = {
  store: DerivedStore;
  // 식별을 읽지 못했을 때 다시 읽기까지의 대기(ms).
  retryMs?: number;
  // 요청이 맞춰지기를 기다리는 최대 시간(ms).
  waitMs?: number;
  // 맞춘 결과. 시험이 옛 ledger의 derived를 버렸는지 본다.
  onReconciled?: (result: { rebuilt: boolean; ledgerId: string }) => void;
};

export function createLedgerGate(options: LedgerGateOptions): LedgerGate {
  const retryMs = options.retryMs ?? 1_000;
  const waitMs = options.waitMs ?? 10_000;
  let settled: Result<void> | undefined;
  let resolveReady: ((result: Result<void>) => void) | undefined;
  const readyPromise = new Promise<Result<void>>((resolve) => {
    resolveReady = resolve;
  });
  let attached = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function settle(result: Result<void>) {
    settled = result;
    resolveReady?.(result);
  }

  async function reconcile(
    read: () => Promise<Result<string, LophnError>>,
  ): Promise<void> {
    if (stopped) return;
    const id = await read();
    if (id.ok) {
      const reconciled = reconcileLedgerBasis(options.store, id.value);
      if (reconciled.ok) {
        options.onReconciled?.({
          rebuilt: reconciled.value.rebuilt,
          ledgerId: id.value,
        });
        settle(ok(undefined));
        return;
      }
    }
    // 식별을 읽지 못했거나 store를 맞추지 못했다. 다시 시도한다.
    timer = setTimeout(() => void reconcile(read), retryMs);
  }

  return {
    ready() {
      if (settled !== undefined) return Promise.resolve(settled);
      return new Promise((resolve) => {
        const wait = setTimeout(
          () =>
            resolve(err({
              code: "unavailable",
              message: "derived store를 현재 ledger에 맞추지 못했다",
            })),
          waitMs,
        );
        void readyPromise.then((result) => {
          clearTimeout(wait);
          resolve(result);
        });
      });
    },
    attach(read) {
      if (attached) return;
      attached = true;
      void reconcile(read);
    },
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
