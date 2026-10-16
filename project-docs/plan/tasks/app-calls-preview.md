# app-calls-preview

preview를 새 호출 모델에 맞춘다: preview process도 core 호출 경로로 부르고(mode `preview`로 구분), 앱 process 시작 입력과 Deno flags는 새 모양(control socket)을 쓰고, 외부에 닿는 대역은 새 broker 서비스(`apps/call`, `projects/list`)에 맞춘다. 문서 저장 대역은 지운다.

- 단위: app-calls (wave 3)
- 선행: app-calls-supervisor (broker 서비스 모양, `PreviewLaunch`, 시작 입력이 먼저 바뀌어야 한다)
- 소유(이 task만 고친다):
  - `packages/core/apps/preview/` (단 `launcher.ts`, `flags.ts`, `model.ts`는 app-calls-supervisor가 이미 바꿨다. 읽기만 한다)
- 읽을 것:
  - spec: S5 4장 끝(preview), 7장, 10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I2.5#21`, `I2.7#20`(test mode의 외부 접속 막기가 이 폴더의 대역으로 되는지 확인), `I2.5#18`(이름). 문맥으로 `I1.5#13`(문서 저장 대역), `I1.5#11`(automation 대역)
  - 지금 코드: `packages/core/apps/preview/*`, 새 broker 서비스 `packages/core/apps/permissions/broker/{apps-call,projects}.ts`(app-calls-supervisor가 만든다), `packages/core/apps/permissions/flags.ts`
- 계약:
  - 쓰는 것: `core/apps/ports.ts`의 `AppApiTarget`을 쓰는 쪽은 호출 경로이고 이 task는 직접 쓰지 않는다. `protocol/apps/calls/broker.ts`의 `brokerAppCallInputSchema`·`brokerProjectsListOutputSchema`, `protocol/apps/previews.ts`(그대로), `permissions/flags.ts`의 `appFlags`·`socketFlags`(`controlSocket`)
  - 내놓는 것: 바뀐 `PreviewService`·대역 묶음. app-calls-assembly가 잇는다.

## 할 일

1. `launcher.ts`, `flags.ts`, `model.ts`는 app-calls-supervisor가 새 시작 입력(`control_socket`)과 flags에 맞춰 바꿨다. 이 task는 그 type(`PreviewLaunch` 등)에 맞춰 나머지 file을 고친다.
2. `service.ts`, `reads.ts` — `/v1/previews/{start,get,stop}`: 관측의 `endpoint`는 `null`로 둔다(protocol 계약이 아직 칸을 요구한다). preview 호출 자체는 이 service를 지나지 않고 core 호출 경로가 `target.mode: "preview"`로 부른다. 이 service는 시작·관측·종료와 disposable 영역(`area.ts`)만 맡는다. 운영 DB·backup·files를 복사하지 않는 규칙은 그대로 둔다.
3. `adapters/` — 외부에 닿는 broker 서비스 대역 (`I2.5#21`)
   - `apps.ts`: 다른 앱 조회 대역을 새 서비스 모양(`brokerAppCallInputSchema`)에 맞춘다. preview 자식은 다른 앱을 부르지 못한다: 대상이 있든 없든 같은 거절(`forbidden`), 시도한 대상과 app-api 이름은 메모리에 남긴다.
   - 새 대역 `projects.ts`: `projects/list`를 빈 목록으로 답한다(preview는 운영 project를 보지 못한다).
   - 지운다: `documents.ts`(문서 저장 대역. `I1.5#13`), `mod.ts`에서 documents·automation·confirm 대역 묶기.
   - `mod.ts`(대역 묶음): net·secret·`appsCall`·`projects` 대역만 묶고, 기록(invocation)·보고(problems) 서비스는 주입받아 그대로 쓴다. 이 묶음을 problems test runner의 `mode=test` 자식도 같이 쓰는지 머리 주석과 호출하는 쪽을 확인한다 (`I2.7#20`). `core/problems/tests/work/`가 따로 대역을 만들고 있으면 고치지 말고 보고한다(releases-problems 소유).
4. `mod.ts`, `area.ts`, `reads.ts` — 위에 맞춰 export 정리. 쓰는 곳이 없는 export는 지운다.
5. 지우기 규칙: 지우거나 이름을 바꾸는 export는 `grep -rn`으로 소유 밖 import를 먼저 본다. 있으면 지우지 않고 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. preview가 운영 data를 열지 않는 규칙은 이 task에서 바뀌지 않는다.
- 남지 않음: `grep -rniE "documents|directSocket|direct_socket|confirm|automation" packages/core/apps/preview`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: core 조립에서 preview service·launcher·대역 묶음을 잇는 곳(app-calls-assembly, 이름이 바뀐 것만)
- 안 쓰게 된 export: 소유 밖이 아직 import하는 옛 이름
- 정한 것: preview 자식의 `projects/list`를 빈 목록으로 한 것
- 계약 바꾸기 요청(wave 3): `protocol/apps/previews.ts`의 `endpoint` 칸 제거 요청
