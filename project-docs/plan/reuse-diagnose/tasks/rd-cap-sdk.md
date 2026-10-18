# rd-cap-sdk

`@lophn/cap-fs`, `@lophn/cap-net`, `@lophn/cap-secret`이 기동 때 설치되게 `deno.json`(판 1.0.0)을 두고, coding agent skill의 SDK 목록에 셋을 더한다. 지금은 `deno.json`이 없어 `installSdkCopies`가 건너뛰고, blueprint가 셋 중 하나를 의존하면 release 준비가 `sdk_not_installed`로 거절한다.

- 단위: rd-cap (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/sdk/cap-fs/**`
  - `packages/sdk/cap-net/**`
  - `packages/sdk/cap-secret/**`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
- 읽을 것:
  - issue: `project-docs/issues/reuse.md`의 "cap-fs, cap-net, cap-secret이 깔리지 않아…"(정한 것: 살린다, 사람)
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`(권한 선언과 approval)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `sdk`(`sdk-api`), `app-capability`, `package-registry`
  - 본보기: `packages/sdk/cap-project/deno.json`; 설치기 `packages/core/apps/packages/install.ts`의 `installSdkCopies`; 권한 규칙 `packages/core/apps/releases/sdk-permissions.ts`
- 계약:
  - 쓰는 것: 설치기가 `packages/sdk/*/deno.json`의 `name`·`version`·`exports`를 읽는다.
  - 내놓는 것: 설치 사본 `<data root>/sdk/cap-fs/1.0.0`, `cap-net/1.0.0`, `cap-secret/1.0.0`. 앱이 `@lophn/cap-fs|cap-net|cap-secret`을 의존으로 선언할 수 있다.

## 할 일

1. 세 폴더에 `deno.json`을 둔다. `cap-project`와 같은 꼴이다: `{ "name": "@lophn/cap-fs", "version": "1.0.0", "exports": "./mod.ts" }` (`cap-net`, `cap-secret`도 이름만 바꾼다). 루트 `deno.json`의 workspace는 `./packages/sdk/*` glob이라 따로 등록하지 않는다.
2. `deno check packages/sdk/cap-fs packages/sdk/cap-net packages/sdk/cap-secret`로 세 package가 workspace 안에서 type check를 통과함을 본다. 안 되면 import를 고친다(이 폴더 안에서만).
3. 설치를 본다(commit하지 않는다): `.dev-data/rd-cap-sdk/`에 core를 한 번 띄워 `<data root>/sdk/cap-fs/1.0.0/mod.ts`, `cap-net/1.0.0/guide.md`, `cap-secret/1.0.0/guide.md`가 생김을 본다.
4. `SKILL.md` 4번 항목의 내장 SDK 괄호 — 지금 "내장 SDK(`@lophn/app-ui`, `@lophn/blueprint`, `@lophn/cap-*`)" — 를 이름을 다 적은 목록으로 바꾼다: `@lophn/app-ui`, `@lophn/blueprint`, `@lophn/cap-app-api`, `@lophn/cap-store`, `@lophn/cap-problem`, `@lophn/cap-project`, `@lophn/cap-fs`, `@lophn/cap-net`, `@lophn/cap-secret`. 한 문장을 덧붙인다: 외부 network(`cap-net`), secret(`cap-secret`), 허락된 경로의 file(`cap-fs`)은 앱이 이 셋으로만 한다. 쓰려면 blueprint에 `permissions`와 `sdk_dependencies`가 있어야 하므로 5번처럼 App Engineer에게 청한다. 이유: SKILL 5번이 의존 변경은 App Engineer 몫이라고 정했다. 이 한 항목 밖은 고치지 않는다(계획 `prompt-text`가 이미 고쳤다).
5. 정직하게 맞춘다: core를 읽어 보면 secret 전달 통로가 production에서 닫혀 있다. `packages/core/main/app-supervisor/broker.ts`의 `closedSecretDelivery`가 기본이고 `brokerAdapters.secrets`를 넘기는 곳이 없어서, `useSecret`은 선언·grant 검사를 통과해도 `unavailable`이다. 사실을 확인한 뒤(위 file과 `packages/core/apps/permissions/broker/secrets.ts`) `cap-secret/guide.md`에 한 줄("secret 전달 통로가 아직 이어지지 않아 live에서는 `unavailable`")을 더하고, SKILL의 위 문장에도 `cap-secret`이 아직 그렇다고 괄호로 적는다. 구현을 이어 붙이는 것은 이 task가 아니다. 보고의 "알려진 미완 동작"에 적는다.
6. `cap-net`도 같은 확인을 한다: 앱 process에 외부 net flag가 없고 broker 전송부(`apps/permissions/broker/net-fetch.ts`)가 https로 보내는데, broker를 실행하는 apps supervisor의 launch spec(`packages/core/apps/control.ts`의 `appSupervisorSpec`)의 `allow_net`에는 core API port와 socket뿐이라 실제 외부 fetch가 Deno 권한에서 막힌다고 읽힌다. 고치는 것은 `rd-cap-net-live`(사람 확인 뒤)다. 이 task는 `cap-net/guide.md`를 고치지 않고, 읽은 사실만 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(설치기의 기존 `install_test.ts`가 설치 동작을 본다).
- 남지 않음: `grep -n "cap-\*" packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. `deno.lock`이 바뀌면 commit하지 않고 알린다.
- 안 쓰게 된 export
- 정한 것: `cap-secret`의 `unavailable` 사실을 guide·skill에 적은 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `cap-secret`은 live에서 `unavailable`(전달 통로 없음). `cap-net`의 실제 외부 fetch 가능 여부(6번에서 읽은 것)
