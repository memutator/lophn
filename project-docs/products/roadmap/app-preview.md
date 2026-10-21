# app preview: 만드는 중인 앱을 사람이 본다

상태: 로드맵. 2026-10-18 사람이 방향을 내고 planner가 정리했다. 2026-10-19 사람이 정할 것을 정했다.
2026-10-19: 앱 interface가 app-api에서 MCP tool(blueprint `tools[]`)로 바뀌었다(`domain.md`, 계획 `domain-entity`). 아래 "지금 코드"는 그 앞 기준이므로 계획을 열 때 코드와 다시 맞춘다. 아래 결정은 그대로 간다.
배경 문서: `project-docs/architecture/app-call.md`(preview mode), `project-docs/architecture/annotation.md`, `project-docs/architecture/coding-agent.md`, `project-docs/products/AGENT-ROLE.md` K2.

## 왜

- 사람은 activation 전에 앱 화면을 볼 수 없다. coding agent가 만든 화면이 맞는지는 activation 뒤에야 확인한다.
- core에는 preview가 있고 coding agent skill도 그것을 쓴다(아래). 하지만 shell에서 그것을 여는 곳이 없다. 반쯤 만든 길이다.
- 사람이 처음 떠올린 것은 browser 탭에 띄운 dev server였다. 하지만 localhost page에는 `window.lophnApp` bridge, view 신원, grant가 없어 앱 tool 호출이 돌지 않는다. 그래서 미리보기는 browser 탭이 아니라 preview mode의 앱 view로 한다.

## 지금 코드

### core

- route는 `/previews/{start,get,stop}`(`packages/protocol/apps/previews.ts`), service는 `packages/core/apps/preview/service.ts`, wiring은 `packages/core/apps/control.ts:213`이다.
- start 입력은 `{app, bundle_hash, release | null, fixture_hash | null}`이다. 하는 일:
  - 준비된 bundle을 data root에서 연다(`packages/core/main/daemon/wiring/apps.ts:155`의 `createCopyPreviewBundles`).
  - disposable 영역 `<data root>/apps/<app>/preview/<nonce>/`를 만든다. `files/`가 있고, fixture가 있으면 `app.sqlite`로 복사한다.
  - Deno child를 띄운다(`preview/launcher.ts`).
- preview는 앱마다 하나다. 새 start가 앞 preview를 멈춘다. ready는 `get`으로 본다.
- 권한(`preview/flags.ts`): `--allow-net`이 없고, 쓰기는 disposable 영역만 되고, 운영 data는 읽지 않는다.
  - runtime mode `preview`에서 net과 secret은 대역이다(`architecture/app-call.md:64`).
  - preview는 rewind하지 않는다(`app-call.md:56`).
- 여는 쪽은 사람과 coding agent뿐이다(`service.ts`의 gate).
  - CLI는 `app preview start`와 `app preview stop`이다(`packages/coding-agent/cli/commands/app.ts:13-14`).
  - skill `lophn-build-app`(`packages/coding-agent/guides/skills/`)이 "fixture 격리 preview"로 쓰라고 한다.
- preview는 dev server가 아니다. source 폴더를 읽지 않고, 고쳐도 다시 build하지 않는다(HMR 없음).
- preview 시작을 shell에 알리는 event는 찾지 못했다.

### shell

- 앱 view는 `mode: "live" | "preview"`를 받는다(`packages/shell/ipc/app-frame.ts:15`, `main/app-frame/registry.ts:87-97`, `main/app-frame/app-connection.ts`의 `currentPreview`).
- renderer에서 앱 view를 여는 세 곳이 모두 `mode="live"`다. 그래서 preview를 여는 UI가 없다.
  - `renderer/workspace/app-panel-tab.tsx:209,222`
  - `renderer/workspace/visuals/app-card-block.tsx:117,129`
  - `renderer/app-frame/app-space.tsx:459`
- layout 파일에는 preview와 transient 탭이 들지 않는다(`main/workspace/schema.ts:11,61`).
- **annotation:** preview view도 앱 registry의 entry라 annotate mode는 돈다. 하지만 `release`가 null인 preview에서 보내면 `main/app-frame/annotate.ts:237`이 "view has no release"로 거절한다.

## 무엇을 만드나

### 1. preview 탭 (shell)

- **kind `app_preview`.** 값은 `{app}`이고, 그 앱에서 지금 돌고 있는 preview를 보인다(`previews.get`). coding agent가 다시 start하면 같은 탭이 새 preview를 load한다.
- **저장하지 않는다.** transient 탭이라 layout.json에 남기지 않는다. preview process는 core와 같이 죽는다.
- **view:** 지금 앱 view를 `mode: "preview"`로 그대로 쓴다. preload, bridge, placement도 그대로다.
- **안내 줄:** 탭 위 한 줄에 preview라는 것, fixture data라는 것, 바깥 연결이 대역이라는 것을 적는다. live와 헷갈리지 않게 한다. [Stop]은 `previews.stop`이다.
- **멈춘 뒤:** preview가 멈추면 탭은 "돌고 있는 preview 없음"을 보인다.

### 2. 여는 길 (core, shell)

- preview가 ready가 되면 core가 event 하나를 낸다. shell은 그 앱의 preview 탭을 연다. 이미 탭이 있으면 그 탭을 다시 load한다.
- **자리:** 그 앱 coding agent의 terminal 탭 옆이다. pane이 둘이면 반대쪽, 하나면 terminal 바로 뒤다(browser-bridge의 여는 자리와 같다).
  - 자리 규칙은 함수 하나로 두고, 이 계획과 `browser-bridge` 가운데 먼저 land하는 쪽이 만든다.
  - coding agent의 terminal이 어느 창과 space에 있는지는 계획을 열 때 확인한다.
- **사람이 여는 길:** 앱 탭 toolbar에 [Preview]를 둔다. 그 앱에 돌고 있는 preview가 있을 때만 보인다.

### 3. preview annotation (shell, core)

- preview 탭에서 보낸 annotation은 그 앱 App Engineer가 받는다(지금과 같다).
- `release`가 null이면 target에 release 대신 preview의 `bundle_hash`를 싣는다. 받는 메시지의 release 줄은 preview와 bundle을 적는다.
- App Engineer는 annotation을 ticket 근거로 붙인다. 진행 중인 ticket이면 coding agent에게 메시지로 넘긴다(AGENT-ROLE A7). coding agent는 `lophn ticket show`로 근거와 screenshot path를 읽는다.

### 4. shell

- **wireframes gallery:** preview 탭(안내 줄, [Stop]), 멈춘 preview, 앱 탭의 [Preview], terminal 옆에 뜬 preview 탭을 더한다.
- **문구:** `wording` skill을 따른다.

## 정한 것 (사람)

- coding agent가 preview를 시작하면 사람 화면에 탭을 저절로 연다.

## 정한 것 (agent)

- dev server(HMR)는 나중이다. 지금 preview(준비된 bundle, fixture data)를 먼저 보이게 하고, 써 보고 모자라면 따로 연다. 근거: AGENTS.md "속도", 미리 만들지 않는다.

- preview는 browser 탭이 아니라 앱 view다. bridge, 신원, grant, annotation이 앱 view에만 있다.
- preview 탭은 앱마다 하나이고, 그 앱의 지금 preview를 따라간다. core가 preview를 앱마다 하나만 두기 때문이다.
- preview 탭은 layout.json에 저장하지 않는다. preview process는 core와 같이 죽는다.
- 이 계획은 `browser-tab`을 기다리지 않는다. 앱 view 길만 쓴다.

## 단계

- 계획 하나 `app-preview`로 연다.
  1. core preview event
  2. preview 탭과 여는 자리
  3. annotation target
  4. gallery와 문구
- 시작 조건은 없다. `workspace-float`의 transient 탭 꼴이 land했으면 그것을 쓴다.

test(AGENTS.md "속도", `write-test` skill):
- preview annotation이 다른 앱의 App Engineer에게 가지 않는다.

계획 끝에 고칠 것:
- `architecture/annotation.md`(preview target), `architecture/app-call.md`(preview를 보이는 길)
- coding agent skill `lophn-build-app`(사람이 preview를 본다는 것). `ae-builds`가 그 skill을 지우면 이 줄도 없어진다.
- changelog 열린 판

## 끝남 기준

- coding agent가 `app preview start`를 하면 terminal 옆에 preview 탭이 뜨고, fixture data로 앱 화면이 돈다.
- 다시 start하면 같은 탭이 새 bundle을 보인다. [Stop]이나 `app preview stop`을 하면 탭이 "돌고 있는 preview 없음"을 보인다.
- preview 탭에서 annotation을 보내면 App Engineer가 받고 ticket 근거로 붙인다. coding agent는 `lophn ticket show`로 screenshot path를 읽는다.
- preview에서 바꾼 data는 live 앱 data에 없다.

## 하지 않는 것

- **dev server(HMR):** source 폴더에서 바로 build한다. 써 보고 모자라면 따로 연다.
- **lophn이 hosting하지 않는 GUI 앱을 탭에 띄우기:** 사람의 다른 web app이나 local 도구 같은 것이다. browser 탭에 URL로 띄울 수는 있지만, 그것을 lophn의 "앱"으로 둘지부터 다시 정해야 한다(release, observation, App Engineer, grant). 따로 roadmap을 쓴다.
- **preview를 live로 올리기:** activation 길(`ticket.verify` 뒤 activation)은 그대로다.
