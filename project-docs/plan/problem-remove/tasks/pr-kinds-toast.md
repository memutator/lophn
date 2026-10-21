# pr-kinds-toast

kinds dispatcher가 위반을 `problem.sync_domain`으로 저장하지 않고, 메모리에서 앞 sync 결과와 비교해 새 위반이 있을 때 남지 않는 event `KindViolationFound`를 낸다. `kind.check`는 그대로다.

- 단위: kinds-toast (wave 3)
- 선행: pr-reactions. 남지 않는 `KindViolationFound`를 거기서 정의한다.
- 소유(이 task만 고친다):
  - `packages/core/projects/kinds/host/dispatcher.ts`
  - `packages/core/projects/kinds/host/credential.ts`
  - `packages/core/projects/kinds/host/watch/service.ts`
  - `packages/core/projects/kinds/worker/jobs.ts`
  - `packages/core/projects/kinds/worker/run.ts`
  - `packages/core/main/daemon/wiring/kinds.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/kinds.md`(흐름 그림과 "지키는 것"의 "위반은 domain 범위 problem" 줄. 이 task가 바꾸는 옛 동작이다), `project-docs/architecture/event.md`(남지 않는 event, Bus)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `kinds`, `events`, `project-docs/module-catalog.yaml`의 `packages/core/projects`(notes), `packages/core/main`
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것 > agent"의 "저장하는 kind 위반을 지운다"와 "뼈대 검토에서 정한 것"의 "켠 뒤 첫 kind 검사는 toast를 띄우지 않는다"
  - 계약: `project-docs/plan/problem-remove/tasks/pr-reactions.md`의 남지 않는 `KindViolationFound`(`packages/protocol/events/transient.ts`)
  - 본보기(코드): `packages/core/problems/domain/model.ts`의 `violationIdentity`(같은 위반의 정체성), `packages/protocol/projects/kinds-work.ts`의 `kindsSyncResponseSchema`, `packages/protocol/projects/kinds-api.ts`의 `violationSchema`, `packages/core/main/daemon/wiring/apps.ts`의 `AppViewSignal`(남지 않는 event를 Bus로 내는 본보기)
- 계약:
  - 쓰는 것: 남지 않는 event `KindViolationFound`(subject `dom` id, payload `{ domain, count }`, `pr-reactions`), Bus의 `publish`(wiring `ctx.bus`), `kindsSyncResponseSchema`의 `violations`
  - 내놓는 것:
    - dispatcher는 domain마다 앞 sync의 위반을 메모리에 두고, 이번 결과에 앞에 없던 위반이 있으면 `KindViolationFound`(`count` = 그 수)를 낸다.
    - 지운다: dispatcher의 `command` 의존, `problem.sync_domain` 호출, `kindsDispatchCredential`, kinds wiring의 `problem.sync_domain` operation 정책과 credential 발급
    - `packages/core/problems/domain`(저장하는 위반)은 `pr-problems-core`가 지운다.

## 할 일

1. dispatcher(`packages/core/projects/kinds/host/dispatcher.ts`)
   - `KindsDispatchDeps`에서 `command`(37-38)와 `newId`(39)를 지우고 `found(domain: string, count: number): void`를 더한다. 앞 sync에 없던 위반이 있을 때 부른다.
   - `reported` map(62-63)과 `report()`(99-123)를 지운다. 그 안의 `deps.newId("prb")`(104)도 같이 없어진다. `pr-cleanup`이 id 접두사 `prb`를 지우면 `newId("prb")`가 type 오류가 되니 다른 자리에 옮기지 않는다. 대신 domain마다 앞 sync의 위반 정체성 집합을 메모리에 둔다(`Map<string, Set<string>>`). 정체성은 `JSON.stringify([v.source, v.kind, v.path, v.field, v.rule])`로 지금 `violationIdentity`와 같은 값이다. 그 함수는 `packages/core/problems/domain/model.ts`에 있고 `pr-problems-core`가 지우며, core feature module끼리는 import하지 않으므로 dispatcher 안에 둔다.
   - `run()`(125-142)이 답을 parse한 뒤: 그 domain의 앞 집합이 없으면(켠 뒤 그 domain의 첫 sync) 지금 집합만 둔다. 있으면 지금 집합 가운데 앞 집합에 없는 것을 세어 1 이상일 때 `found(domain, count)`를 부르고, 지금 집합으로 바꾼다. 비교 대상은 답의 `violations`뿐이다(지금 `problem.sync_domain`이 받던 것과 같다). `found`가 던져도 sync 결과는 돌려주고 `deps.log`로 남긴다.
   - 실패한 sync(worker 답 없음, parse 실패)는 집합을 바꾸지 않는다.
   - 머리 주석(1-6)과 62줄 주석을 새 동작으로 고친다. import에서 `problemSyncDomain`(9), `CommandEnvelope`(18)를 지운다.
2. `packages/core/projects/kinds/host/credential.ts`(`kindsDispatchCredential`)를 file째 지운다.
3. wiring(`packages/core/main/daemon/wiring/kinds.ts`)
   - `operations`(53-60)를 지운다.
   - start의 credential 발급(87-98: `registry.issue`, `revalidate`, `runtime.record`)과 dispatcher에 넘기던 `command`(114-119), `ids`(99), `newId`(120)를 지운다. 쓰지 않게 된 import(`problemSyncDomain`, `kindsDispatchCredential`, `createIdSource`)를 정리한다. build의 `writer`(감시 다시 정하기)는 그대로다.
   - `found`는 `ctx.bus.publish({ type: "KindViolationFound", subject: domain, at: ctx.clock.now(), payload: { domain, count } })`로 낸다.
   - 머리 주석(1-3)의 "위반을 problem으로 올리고"를 새 동작으로 고친다.
4. 주석만 고친다: `packages/core/projects/kinds/host/watch/service.ts` 2줄("위반이 늘면 problem으로 올리려는 것"), `packages/core/projects/kinds/worker/jobs.ts` 3줄("core가 위반을 비교해 problem으로 올린다"), `packages/core/projects/kinds/worker/run.ts` 5-6줄("problem으로 올리는 일은 core가 한다")을 "core가 앞 결과와 비교해 새 위반을 사람에게 알린다" 쪽으로 바꾼다.

## 정한 것

- 비교 기준은 domain마다의 위반 정체성 집합이고 메모리뿐이다. 켠 뒤 그 domain의 첫 sync는 기준만 두고 event를 내지 않는다(README "뼈대 검토에서 정한 것"). 나중에 생긴 domain도 첫 sync는 기준이다.
- 목록이 200개에서 잘렸어도(`truncated`) 같은 방식으로 비교한다. 이유: toast는 사람에게 가는 알림일 뿐 상태를 바꾸지 않는다. 잘린 목록 사이에서 생길 수 있는 거짓 toast는 받아들인다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. toast는 사람에게 가는 알림이고 data나 권한에 닿지 않는다. 위반 판정 자체(worker)는 바뀌지 않는다.
- 남지 않음: `grep -rni "problem" packages/core/projects`가 0줄이고, `grep -rn "newId(\"prb\")" packages/core/projects packages/core/main/daemon/wiring/kinds.ts`가 0줄이고, `grep -rn -E "problemSyncDomain|kindsDispatchCredential|problem\.sync_domain" packages/core/projects packages/core/main`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `KINDS_DISPATCH_PRINCIPAL`(`packages/protocol/projects/kinds-work.ts`)은 이 task 뒤 `packages/core/problems/domain/commands.ts`만 쓴다. 그 밖에 생기면 적는다
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
