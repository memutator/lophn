# use-contract-sdk

`use-contract`가 고정하는 caller의 `remote` 종류와 broker 본문의 `machine`을, protocol의 손 사본 셋에 같이 받게 하고 SDK `@lophn/cap-tool`을 올린다(2.2.0 → 2.3.0). 앱 process는 schema 검증 library를 싣지 않아 protocol schema의 손 사본이 셋 있고(`app-call.md` 지키는 것 8) 하나라도 빠지면 그 caller의 호출이 앱에서 말없이 거절된다. 이 task는 `use-contract`의 code를 기다리지 않는다: 아래 "만드는 모양"은 그 brief "내놓는 것"의 같은 줄이고, 둘이 서로의 file을 import하지 않는다(손 사본이라 import할 수 없다).

- 단위: use (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/invocations/context.ts`, `packages/core/apps/runtime/entrypoint/{wire,broker-client}.ts`(손 사본 둘)
  - `packages/sdk/cap-tool/{context,connect}.ts`(손 사본과 `connectCommands`), `packages/sdk/cap-tool/guide.md`, `packages/sdk/cap-tool/package.json`(2.2.0 → 2.3.0), `packages/core/agent-workspaces/skills/migrate-sdk/cap-tool-2.3.0.md`(새 file)
  - pin 자리(`sdk-note`의 grep으로 찾은 것만): `packages/core/apps/packages/template/app/{lophn.ts.tmpl,package.json.tmpl}`(지금 `cap-tool` 2.2.0), `tests/support/app/sample/lophn.ts.tmpl`, `package-lock.json`. phone 하한(`core/apps/releases/prepare/checks.ts`, `design-app/phone-apps.md`의 2.2.0)은 pin이 아니라 하한이라 올리지 않는다.
- 읽을 것:
  - `project-docs/plan/remote-use/tasks/use-contract.md`의 "내놓는 것"(`requester.ts`, `caller.ts`, `broker.ts` 줄)
  - architecture: `app-call.md`(지키는 것 "호출 경로" 8과 "경계와 계약"의 caller 본문)
  - skill: `.claude/skills/sdk-note/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 변경 기록: `project-docs/products/change-log/0.23/carry-paths.yaml`(event caller의 `machine`을 protocol에 두고 손 사본에는 두지 않았다)
- 계약:
  - 쓰는 것: protocol의 `appToolCallerSchema`(`packages/protocol/apps/calls/caller.ts`)와 `brokerAppCallInputSchema`(`broker.ts`)가 가진 지금 모양(읽기만. 고치는 것은 `use-contract`)
  - 만드는 모양(`use-contract`의 "내놓는 것"과 같다. 어긋나면 `use-contract`가 맞다고 보고 계약 바꾸기 요청에 적는다):
    - caller `{kind:"remote", machine: mch_, device: dev_, requester: Requester}`. `Requester` = `{kind:"screen"} | {kind:"terminal"} | {kind:"agent", agent, session: ses_ | null, name} | {kind:"app", app}`.
    - event caller의 `machine?: mch_`(protocol에는 이미 있다).
    - broker `appsCall` 본문의 `machine?: <기계 이름 | mch_ | dev_>`(1~64자).
  - 내놓는 것: SDK `connectCommands(app, commands, options?: {on?: string})`. `use-send`가 broker 쪽 handler를 짓는다(이 task의 SDK를 import하지 않는다).

## 할 일

1. 손 사본 셋을 위 모양으로 맞춘다: `core/apps/invocations/context.ts`의 `AppCaller`, `entrypoint/wire.ts`의 caller parser(`remote`를 받는다. 지금 event의 `machine`과 person의 `device`·`machine`은 셋 모두에 없고 parser가 아는 칸만 옮겨 버린다: event의 `machine`도 같이 더한다), SDK `cap-tool/context.ts`. `entrypoint/broker-client.ts`는 `appsCall` 본문에 `machine?`를 싣는다.
2. SDK `connectCommands(app, commands, options?: {on?: string})`(`connect.ts` 158줄, 지금 `(app, commands)`)가 `on`이 있으면 broker 본문에 `machine`으로 싣는다. `guide.md`에 한 단락(다른 기계의 앱 부르기, `remote` caller).
3. `sdk-note` skill대로: `cap-tool` 2.3.0(minor), pin, `migrate-sdk` 메모 `cap-tool-2.3.0.md`(Instruction diff 포함), `node tools/check-sdk-notes.ts`. `cap-tool`은 다른 SDK package를 pin하지 않고 `@lophn/declaration`(4.10.0)·`@lophn/app-ui`(2.21.0)·`@lophn/app-ui-native`(1.8.0)는 이 task가 올리지 않는다(`use-events`가 올린다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 손 사본이 protocol과 같이 받는지 보는 기존 test(`calls_test.ts`의 `parseProcessCall`, 앱 process의 caller parser test)가 있으면 `remote`·event `machine` 줄을 더하고, 새 test file은 만들지 않는다.
- subprocess·서버를 띄우는 test는 만들지 않는다.
- 남지 않음: 없음(지우는 것이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`package.json`, pin). 이 task는: `package-lock.json` 갱신 여부
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `use-contract`의 모양과 어긋나는 곳
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## 시작 전에 다시 볼 것

- 없음(이 brief를 쓴 날 code로 확인했다). `cap-tool`이 2.2.0인지와 `connectCommands`의 인자만 한 줄로 본다.
