# artifact: agent의 결과를 화면으로 받는다

상태: 로드맵. 2026-10-18 사람이 방향을 내고 planner가 정리했다. 2026-10-19 `domain.md`에 맞춰 다시 썼고, 사람이 정할 것은 모두 정했다.
배경 문서: `project-docs/products/roadmap/domain.md`("view와 artifact", "폴더"), `project-docs/PRODUCT.md` 4절 축 2·6절 "그다음", `project-docs/architecture/annotation.md`, `project-docs/products/roadmap/browser-tab.md`(3. 로컬 HTML 미리 보기).
가져올 것: `../rea/project/desktop-embeded-browser`의 `src/main/sandbox.js`(봉한 partition). browser-tab roadmap의 3번 "로컬 HTML 미리 보기"는 이 문서가 맡는다.

## 왜

- **PRODUCT 축 2:** 사람에게 오는 interface가 채팅 화면에 갇히면 안 된다. 6절은 이것을 MVP 다음으로 두었다.
- **agent가 맡는 일이 커질수록 사람에게 오는 data는 low level이 된다.** 예: eval은 run 기록, verdict, 공통 수치를 남기고 experiment 설계까지 agent가 한다(`roadmap/eval.md`). 사람에게 필요한 것은 experimenter가 결과를 시각화한 화면 하나다.
- **지금 agent 결과가 사람에게 가는 길은 대화 글, 파일, 앱 화면 card(`visual.show`)뿐이다.** 앱 card는 blueprint가 `card` 크기 화면을 선언한 앱에만 된다. 한 번 낸 분석이나 보고를 화면으로 보일 곳이 없다.
- **`.html` 파일은 어디서도 그려지지 않는다.** document editor가 text로 연다.

## 지금 코드

### 결과가 남는 곳

- **message part:** `text`, `attached`, `app_card` 셋이다(`packages/protocol/lophn-agent/message-content.ts:20-52`). `app_card`는 `visual.show`(`packages/core/apps/agent-tools/visual.ts`)만 만들고, renderer는 `EmbeddedView`(`mode="live"`)로 그린다(`packages/shell/renderer/workspace/visuals/app-card-block.tsx`).
- **결과 entity는 없다.** Operator가 "결과를 남긴다"(AGENT-ROLE O1)는 것은 파일 쓰기, `reply`·`call`, app-api 호출, `visual.show`다.
- **file 범위:** `placeScope`(`packages/core/agent-roles/place/place-folders.ts:19`)가 정한다.
  - tool은 `file.write`, `file.edit`, `shell.run`이다(`agent-roles/tool-lists.ts`의 `WORK_TOOLS`).
  - rewind는 `file.write`와 `file.edit`만 기록한다(`agent-roles/hooks.ts`의 `FILE_HOOKS.aroundWrite`). 기록은 `rewind_files`에 checkpoint(session의 메시지)별로 남는다(`lophn-agent/session/rewind/record.ts`).
  - skill과 agent 정의는 lophn data에 있어 file tool이 닿지 않는다(`agent-roles/hooks.ts:7`).
- **`.html` 열기:** `fileKindOf`(`packages/shell/renderer/editor/model.ts:11`)는 markdown, image, pdf 밖을 모두 text 편집기로 연다. `.html`도 여기에 든다.

### view 길

- **앱 view**(`packages/shell/main/app-frame/`): `lophn-app://` scheme, 앱마다 partition, `preload-app`(`window.lophnApp` bridge와 annotate layer)이다.
- **browser view**(계획 `browser-tab`, land하고 닫혔다. `77bfac2d1`)
  - `main/browser/registry.ts`가 앱 registry와 따로 view를 갖는다. `main/browser/frame-router.ts`가 placement와 visibility를 앱 view와 같이 쓰게 나눈다. preload는 없다.
  - navigation 규칙(`main/browser/navigation.ts`의 `decideNavigation`)은 main frame에서 http, https, `about:blank` 밖을 막는다. custom scheme도 막는다.
- **appearance CSS:** `lophn-shell:`과 `lophn-app:` 문서에만 넣는다(`main/desktop/wiring/appearance.ts`).

### annotation

- **page layer:** `packages/shell/preload/annotate/`(5 file, 600줄)는 DOM만 쓰고 transport를 주입받는다(`installAnnotate({send, on})`). `data-lophn-component`가 없으면 component는 null이고, element의 role, 이름, 글자를 쓴다.
- **main 쪽:** `main/app-frame/annotate.ts`(372줄)는 신원을 앱 registry의 sender view(app, release, screen)로 정한다.
- **core:** `annotations.send`(`packages/protocol/apps/annotation.ts`)는 `{app, session, annotations[1..20]}`을 받는다. 받는 쪽은 그 앱 App Engineer뿐이다(`packages/core/apps/annotations/send.ts`).
- **screenshot 읽기:** `annotations.get`은 App Engineer, coding agent, 사람만 쓴다(`packages/core/agent-roles/credentials.ts`).

### 선례

- **rea `src/main/sandbox.js`(148줄)**
  - `session.protocol.handle(scheme)`이 `realpath(root)` 안의 일반 파일만 준다(`O_NOFOLLOW`, 4 MiB).
  - 응답 CSP는 `connect-src 'none'`, `object-src 'none'`, `form-action 'none'` 등이다.
  - 죽은 proxy(`http://255.255.255.255:9`)를 걸고 실제로 막히는지 확인한다. permission은 거절하고 download는 취소한다.
- **Claude desktop:** artifact를 `persist:cowork-artifact` partition과 `cowork-artifact://` scheme의 봉한 view로 띄운다(rea `analysis/embedded-browser-reverse-engineering.md:492`).
- **ChatGPT·Codex**(`project-docs/tmp/browser-anottation/`): annotation을 artifact 파일마다 모아 "Apply these N annotations"로 그 대화에 한 번에 보낸다.

## 무엇을 만드나

### 1. artifact model

artifact는 domain view의 정적 끝이다(`domain.md` "view와 artifact"). kind가 아니다.

```
<data>/domains/세금/artifacts/spending/      artifact 하나 = 폴더 하나
├── index.html          필수. 입구이자 template
├── chart.js            선택. 같은 폴더 안의 파일은 상대 경로로 읽는다
└── data/               선택. template이 읽는 data
    ├── 2026-01.json
    └── 2026-02.json
```

| 항목 | 모양 |
|---|---|
| 자리 | lophn의 자리 `<data>/domains/<domain>/artifacts/<name>/`이다. 모든 domain에 있다 |
| 신원 | `{domain, name}`이다. name은 폴더 이름(slug)이다 |
| 제목과 설명 | `index.html`의 `<title>`과 `<meta name="description">`이다. program이 HTML에서 읽어 artifact 목록과 prompt에 쓴다 |
| page | 입구는 `index.html`이다. 같은 폴더 안의 다른 HTML로 가는 상대 link는 된다 |
| data | `data/` 아래 JSON 파일이다. 보통 agent가 tool(예: `list`의 집계)을 불러 만든다. 기본으로 kind가 아니다. template이 기대하는 모양이 자주 깨지면 Domain Engineer가 `data/*.json`을 kind로 선언한다 |
| `data/` 목록 | view가 가상 파일 `_entries.json`(이름, 크기, 고친 시각, 이름 순)을 만들어 준다. 디스크에는 쓰지 않는다 |
| 판 | 두지 않는다. 고친 것은 rewind로 되돌린다. 지난 data를 남기려면 `data/`에 파일을 쌓는다 |

- **일회성, 갈아끼우기, series는 종류가 아니다.** template이 `data/`를 어떻게 읽느냐의 차이다.
  - 일회성: data를 `index.html` 안에 담는다.
  - 갈아끼우기: template은 두고 `data/latest.json`만 바꾼다.
  - series: `data/`에 파일이 쌓이고, template이 `_entries.json`을 읽는다.
- **수명**

  | 일 | 어떻게 |
  |---|---|
  | 만들기, 고치기 | `file.write`다. 관례 자리에 `index.html`이 생기면 artifact다. artifact 전용 tool은 없다 |
  | 쓰는 쪽 | home domain의 Domain Engineer와 Operator다. 그 domain의 file 범위에 lophn의 자리 `artifacts/`가 들어간다. terminal의 coding agent도 파일만 쓰면 된다. 예: eval experimenter |
  | 찾기 | program이 `artifacts/*/index.html`로 domain의 artifact 목록을 만든다. 그 domain agent의 prompt와 domain 화면에 쓴다 |
  | 알리기 | agent가 말로 한다. 대화 글의 artifact path는 renderer가 link로 그린다 |
  | live view로 키우기 | Domain Engineer가 ticket을 쓰고, coding agent가 `source/`의 live view로 옮긴다. 그 뒤 정적 artifact는 지운다(`domain.md`) |
  | 지우기 | 사람이 화면에서 지우거나 agent가 지운다 |

### 2. artifact 탭 (shell)

- **kind `artifact`.** layout은 `{key, domain, name}`이다. 다시 열면 그 artifact를 load하고, 폴더가 없으면 placeholder다.
- **여는 길**
  - domain 화면의 artifact 목록
  - 대화 글의 artifact link
  - 사람의 폴더에 있는 아무 `.html` 파일. 이때 root는 그 파일이 든 폴더다. browser-tab roadmap 3번이 이것이다.
  - 탭의 [Edit source]가 text 편집기를 연다.
- **view:** `WebContentsView` 하나다. placement, visibility, overlay 순서, crash 처리는 browser view registry의 꼴을 따라 다시 쓴다. 새로 짜지 않는다.
- **봉한 partition**(rea `sandbox.js`를 TS로 옮긴다)
  - partition은 `persist:lophn-artifact` 하나이고, scheme은 `lophn-artifact://`다.
  - root는 artifact 폴더다. realpath가 root 안인 일반 파일만 주고, 크기에 상한을 둔다. 폴더 밖 파일, 다른 artifact, 사람의 문서는 읽지 못한다.
  - CSP는 rea 기본값에서 `connect-src 'self'`만 바꾼다. template이 자기 `data/`를 fetch해야 갈아끼우기와 series가 된다.
  - 밖으로는 죽은 proxy가 막는다.
  - permission, download, popup, 다른 scheme으로 가는 navigation은 거절한다. http와 https link는 사용자 입력 뒤에만 browser 탭으로 연다.
  - 외부 library와 CDN은 없다. inline이나 같은 폴더의 파일로 둔다.
- **appearance CSS**(token, dark mode)를 `lophn-artifact:` 문서에도 넣는다. 그래서 agent가 lophn과 같은 색을 쓴다.
- **다시 load:** 파일이 바뀌면 다시 load한다. agent가 고친 것이 바로 보인다.
- **preload:** annotate layer만 싣는다. tool을 부르는 bridge는 없다. 이것이 live view와 갈리는 곳이다.

### 3. 대화와 prompt (core, shell)

- **prompt:** 그 domain agent의 prompt에 artifact 목록(name, 제목, 설명)을 싣는다. program이 결정적으로 만든다.
- **link:** renderer는 대화 글에서 그 domain의 artifact path를 찾아 link로 그린다. 누르면 artifact 탭이 열린다.
- **guide:** 내장 guide `artifact`가 다음을 적는다. Domain Engineer와 Operator의 지침이 이 guide를 가리킨다.
  - 자리와 폴더 모양
  - `data/`와 `_entries.json`
  - 제목과 설명
  - network 없음
  - appearance token

### 4. artifact annotation (shell, core)

- **annotate mode:** artifact 탭에서도 켠다. page layer는 그대로 쓰고, transport는 artifact preload다.
- **신원:** shell main이 view로 정한다(`{domain, name}`). page가 보낸 값은 쓰지 않는다. 지금 규칙과 같다.
- **target:** core `annotations.send`의 target을 앱(지금 모양)과 artifact(`{domain, name}`)의 union으로 넓힌다. 앱 target은 `domain.md` 3단계에서 domain에 맞춰 바뀐다.
- **받는 쪽:** 그 artifact 폴더에 마지막으로 쓴 session이다.
  - `rewind_files`와 checkpoint의 session에서 결정적으로 뽑는다.
  - 기록이 없으면 그 domain의 Domain Engineer가 받는다. 기록이 없는 경우는 사람이나 terminal이 쓴 artifact, 또는 rewind 기록 상한으로 지워진 경우다.
  - 사람 메시지 하나로 넣고 agent pane에 그 session을 연다.
  - 사람의 폴더에 있는 `.html`도 annotation은 그 domain의 Domain Engineer가 받는다.
- **screenshot 읽기:** `annotations.get`을 Domain Engineer와 Operator에게도 주고, agent의 home domain으로 거른다. 그러면 `image.read "annotation:<id>"`가 그대로 된다.
- **sweep:** artifact annotation은 ticket 근거가 되지 않는다. sweep 규칙(가리키는 메시지가 있는 동안 남는다)은 그대로다.

### 5. shell

- **wireframes gallery:** artifact 탭, [Edit source], domain 화면의 artifact 목록, 대화 글의 artifact link, artifact annotate mode, 폴더가 없을 때를 더한다.
- **문구:** `wording` skill을 따른다.

## 정한 것 (사람)

- artifact는 domain view의 정적 끝이다. context search에 묶는 안은 없어졌다(`domain.md`).
- artifact는 lophn의 자리(`<data>/domains/<domain>/artifacts/`)에 둔다.
- role agent가 정적 view(HTML)를 직접 쓴다. PRODUCT 3절 "lophn agent는 코드를 짜지 않는다"를 "앱 코드(domain tool, live view)는 짜지 않는다. 정적 view는 결과 문서라 직접 쓴다"로 고친다.

## 정한 것 (agent)

- **artifact 전용 tool을 두지 않는다**(`artifact.show`도 `artifact.publish`도 두지 않는다).
  - 만들기는 `file.write`, 찾기는 관례 자리, 알리기는 agent의 말과 renderer link다.
  - annotation을 받는 쪽은 rewind 기록으로 정한다.
  - 근거: tool이 하려던 일이 모두 이미 있는 장치로 된다.
- **제목과 설명은 HTML에서 읽는다.** metadata 파일을 따로 두면 둘이 어긋난다. agent가 HTML을 쓸 때 원래 같이 쓰는 값이다.
- **봉한 view는 browser 탭과 다른 kind다.** browser 탭의 navigation 규칙과 partition(로그인 cookie)을 섞지 않는다. Claude desktop도 같다.
- **network와 외부 library는 없다.** 사람의 data가 담긴 page가 바깥 server를 부르지 않게 한다. rea와 Claude desktop이 같은 길이고, 이 쪽이 더 단순하다.
- **CSP는 `connect-src 'self'`다.** template이 data 파일을 읽어야 갈아끼우기와 series가 된다. root 밖은 scheme handler가 막는다.
- **`_entries.json`은 view가 만든다.** agent가 목록을 손으로 맞추다 틀릴 일이 없다.
- **preload에 annotate layer를 싣는다.**
  - browser 탭의 "IPC 0개"는 인터넷 page에 대한 규칙이다. artifact는 lophn이 만든 결과다.
  - AI가 쓴 코드이지만 앱 view의 preload와 같은 위험이다. 막는 것은 폴더 밖 읽기와 바깥 network다(AGENTS.md "속도").

## 단계

- **시작 조건**
  - 계획 `browser-tab`이 main에 land한 뒤다. browser view registry와 `frame-router.ts`의 꼴을 다시 쓴다.
  - `domain.md` 1단계(`domain-model`) 뒤다. lophn의 자리, home domain, file 범위가 있어야 한다. 2단계(MCP)는 기다리지 않는다.
- **계획 하나 `artifact`로 연다.**
  1. 봉한 scheme과 그 path 해석
  2. artifact 탭과 domain의 artifact 목록
  3. prompt의 artifact 목록, 대화 link, guide
  4. annotation target과 받는 쪽
  5. gallery와 문구

test(AGENTS.md "속도", `write-test` skill):
- **봉한 scheme의 path 해석:** `..`, 절대 path, symlink 탈출, realpath가 root 밖인 파일을 거절한다. sandbox 경계다.
- **annotation target:** artifact annotation이 다른 domain의 session으로 가지 않는다.
- **Electron을 띄우는 check:** 죽은 proxy 확인 같은 것은 만들기 전에 사람에게 묻는다.

계획 끝에 고칠 것:
- `project-docs/architecture/artifact.md`를 새로 쓴다.
- `architecture/annotation.md`(target과 받는 쪽), changelog 열린 판을 고친다.
- browser-tab roadmap의 3번을 지운다.

## 끝남 기준

- Operator에게 "이번 달 지출을 그래프로 보여 줘"라고 한다.
  - Operator가 `artifacts/spending/`에 `index.html`과 `data/`를 쓰고, 대화에 그 path를 말한다.
  - path가 link로 보이고, 누르면 artifact 탭에 그래프가 그려진다.
- 다음 달 data 파일을 하나 더 쓰면 template은 그대로다. 탭이 다시 load되어 새 data가 보인다.
- artifact 안의 `fetch("https://example.com")`과 root 밖 파일 읽기가 실패한다.
- 탭에서 막대 하나에 annotation을 달아 보낸다.
  - 그 artifact를 쓴 Operator session에 메시지로 간다.
  - Operator가 `image.read`로 screenshot을 읽고 파일을 고치면 탭에 바로 보인다.
- 사람이 terminal로 만든 artifact에 annotation을 보내면 그 domain의 Domain Engineer가 받는다.
- lophn을 다시 띄우면 artifact 탭이 같은 artifact로 돌아온다.
- 사람의 폴더에 있는 아무 `.html`이나 열면 artifact 탭으로 그려진다.

## 하지 않는 것

- **인터넷 page(browser 탭)의 annotation.** transport와 받는 쪽이 정해진 뒤 따로 roadmap을 쓴다.
  - transport: guest preload 없이, main이 isolated world에 다음 event를 기다리는 호출을 되풀이하는 long-poll이 되는지 확인해야 한다.
  - 받는 쪽: browser-bridge가 아는, 그 page를 연 terminal이다.
- **artifact 공유, 내보내기, 판 기록.** 파일 rewind가 있다. 사람이 lophn 밖에서 봐야 하면 [폴더 열기]나 내보내기를 그때 붙인다.
- **외부 library와 CDN.**
- **대화 안에 artifact를 live로 끼워 그리기.** link로 탭을 연다.
- **tool을 부르는 view.** live view의 일이다(`domain.md`).
