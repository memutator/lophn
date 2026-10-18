# ex-parallel

trial을 동시에 돌리는 pool을 만든다. 종류(kind)마다 동시 수 한도가 있고, experiment 하나에 예산 하나를 같이 쓴다. 예산을 넘으면 새 trial을 띄우지 않고, 이미 도는 trial은 끝낸다. 순수 로직이다. trial을 도는 함수와 예산 장부는 주입받는다.

- 단위: ex-parallel (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/experiment/parallel/**`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "병렬과 의존"(trial마다 root·port·harness HOME이 따로라 서로 막지 않는다. 같이 쓰는 한도는 experiment 전체의 $ 상한 하나, provider rate limit, 기계 자원. coding agent trial은 무거워서 동시에 1~2개), "정한 것"(첫 상한 experiment 하나 $100)
  - 계획: `project-docs/plan/eval-experiment/README.md`("병렬과 예산": 판단 case 4개, coding agent trial 2개, experiment 하나에 예산 하나 기본 $100)
  - eval-base brief: `ev-runner.md`의 "할 일 4"(`createCap(limitUsd)`: `add(usd)`, `exceeded()`, `total()`와 `runTrials(count, runOne, cap)`). 이 pool이 `runTrials`를 대신한다(ex-cli가 `runTrials`를 지운다).
- 계약:
  - 쓰는 것: 없음. `createCap`을 import하지 않는다. 아래 `Budget` 모양이 `createCap`의 반환과 같아서 ex-cli가 그대로 꽂는다. `tests/eval/types.ts`도 import하지 않는다.
  - 내놓는 것(`tests/eval/experiment/parallel/mod.ts`). ex-cli가 기댄다:
    ```ts
    export type TrialKind = "judgment" | "coding";
    export const DEFAULT_LIMITS: Readonly<Record<TrialKind, number>>;   // { judgment: 4, coding: 2 }
    // 시나리오의 real에 role이 "coding_agent"인 참가자가 있으면 "coding", 아니면 "judgment".
    export function trialKindOf(scenario: { real: readonly { role: string }[] }): TrialKind;

    export type Budget = { add(usd: number): void; exceeded(): boolean; total(): number };
    export type Job<T> = {
      id: string;                                   // 로그용. 예 "L4-app#1"
      kind: TrialKind;
      run(): Promise<{ value: T; cost_usd: number }>;   // cost_usd는 trial의 role agent 비용. 채점과 사람 역할은 agent가 하므로 key 비용이 없다
    };
    export type JobResult<T> =
      | { status: "done"; id: string; value: T; cost_usd: number }
      | { status: "failed"; id: string; error: string }              // run이 던졌다. 비용은 0으로 센다
      | { status: "skipped"; id: string; reason: "budget" | "stopped" };   // 띄우지 않았다
    export type Pool = {
      submit<T>(job: Job<T>): Promise<JobResult<T>>;   // 끝나거나 건너뛸 때 풀린다. 던지지 않는다
      stop(): void;                                    // 새 job을 띄우지 않는다. 도는 job은 끝낸다
      halted(): "budget" | "stopped" | null;           // 지금 새 job을 띄우지 않는 이유. 아니면 null
      running(): Record<TrialKind, number>;
    };
    export function createPool(options: {
      budget: Budget;
      limits?: Partial<Record<TrialKind, number>>;     // 기본 DEFAULT_LIMITS. 1보다 작으면 던진다
    }): Pool;
    ```

## 할 일

1. `parallel/kind.ts`: `TrialKind`, `DEFAULT_LIMITS`, `trialKindOf`. 이유: 한도를 kind별로 두는 것이 계획의 결정이다(coding agent trial은 무거워 2개, 판단 case는 4개).
2. `parallel/pool.ts`: `createPool`.
   - kind마다 줄(FIFO)과 도는 수가 따로다. `submit`은 줄에 들어가고, 그 kind의 도는 수가 한도 아래가 되면 순서대로 시작한다.
   - **띄우기 직전에** 확인한다: `stop()`이 불렸으면 `skipped`/`stopped`, `budget.exceeded()`면 `skipped`/`budget`. 줄에서 기다리던 job도 같은 확인을 받는다. 이유: roadmap "넘으면 새 trial을 띄우지 않는다". 제출할 때가 아니라 띄울 때 보는 것이 맞다(긴 trial이 도는 동안 예산이 찬다).
   - job이 끝나면 `budget.add(cost_usd)`를 부르고 슬롯을 돌려준 뒤 줄의 다음 job을 본다. 이미 도는 job은 예산이 차도 죽이지 않는다(roadmap: 도는 trial은 끝낸다. 한 trial 안의 상한은 runner가 지킨다).
   - `run`이 던지거나 reject하면 `failed`로 끝내고 pool은 계속한다. 이유: trial 하나의 core 오류가 다른 trial을 죽이면 안 된다.
   - `halted()`: `stop()`이 불렸으면 `"stopped"`, 아니면 `budget.exceeded()`면 `"budget"`, 아니면 `null`. ex-cli가 마지막에 "상한에 걸려 멈춤"을 찍는 데 쓴다.
   - 시간(`setTimeout`)과 난수를 쓰지 않는다. 시작은 `queueMicrotask`나 promise 연결로 하고, 슬롯이 나면 같은 tick에서 다음을 띄운다. 이유: test가 직접 promise를 풀어 순서를 본다.
3. `parallel/mod.ts`가 위를 모두 내보낸다. 전역 mutable 상태를 두지 않는다(상태는 `createPool` 안).
4. test (`parallel/pool_test.ts`): 아래 "끝남".

## 정한 것

- pool은 trial 정책을 모른다. 정책(몇 번 더 돌릴지)은 ex-trials가 정하고, ex-cli가 "한 시나리오 안에서 `await pool.submit(...)` 한 뒤 결과를 보고 `submit`을 또 부르는" 흐름으로 잇는다. 이유: 정책이 결과에 따라 job을 더해야 하는데 pool이 미리 job 목록을 받으면 그것을 못 한다. `submit` 하나가 가장 단순하다.
- 예산은 job이 끝난 뒤에 센다. 그래서 동시에 도는 만큼(최대 `4 + 2` 개) 예산을 넘겨 쓸 수 있다. 이유: 도는 trial의 비용은 끝나야 안다(`modelCallList`의 cost를 더한다). 넘는 폭은 한 trial 상한($50, eval-base) 이내로 본다. 더 줄이려면 job이 `cost_so_far`를 알리게 해야 하는데 지금은 필요 없다.
- `Budget`은 `createCap` 모양(`add`, `exceeded`, `total`)을 구조로만 받는다. 이유: eval-base의 `runner/`를 이 task가 import하면 방향이 거꾸로다.
- `stop()`은 SIGINT 같은 신호를 ex-cli가 걸어 부른다. 이유: roadmap "runner는 보고, 이상하면 멈추라고 요청한다". 돈이 새지 않게 새 job만 막는다.

## 끝남

- `deno task check`가 통과한다. `parallel/pool_test.ts`는 core, subprocess, network, 시간 대기를 쓰지 않는다(job은 손으로 푸는 promise).
- 위험 test(`parallel/pool_test.ts`, 두 개):
  1. "kind별 동시 수 한도를 넘겨 띄우지 않고, 한 kind가 차도 다른 kind는 막히지 않는다": judgment 한도 4에 job 6개를 내면 4개만 시작하고, 하나를 풀면 다섯째가 시작한다. coding 한도 2에 job 3개는 judgment가 차 있어도 둘이 시작한다. 한도를 넘기면 core를 여럿 띄워 기계가 멈춘다.
  2. "예산이 차거나 `stop()`이면 줄에서 기다리던 job을 띄우지 않고 `skipped`로 돌려주며, 도는 job은 끝까지 가서 그 비용이 장부에 남는다": 장부는 가짜 `Budget`. 돈이 새는 쪽의 경계다.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다.
- 남지 않음: 해당 없음(새 코드). `runTrials` 지우기는 ex-cli의 일이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음(eval-base의 `runTrials`는 ex-cli가 지운다)
- 정한 것: 위 "정한 것"과 다르게 한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 예산 초과 폭(동시에 도는 trial의 비용)을 미리 막지 못한다. provider rate limit은 보지 않는다(role agent가 4개 동시에 부르는 정도는 괜찮다고 본다).
