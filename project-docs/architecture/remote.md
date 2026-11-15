# remote

폰 앱이다. pairing한 폰이 컴퓨터의 core에 붙어 lophn agent의 session 목록을 보고, 대화를 읽고 보내고 멈추고, 승인과 질문에 답하고, job을 켜고 끄고, project의 file을 읽는다. 폰 화면은 폰 앱(`mobile`)의 native React Native 화면이고 폰 UI kit(`@lophn/ui-native`, `ui-kit.md`)으로 짓는다. 컴퓨터가 화면을 내려주지 않는다. 연결(listener, Noise, pairing)은 `platform.md`의 "폰이 붙는 listener", 기기 자격과 route 목록은 `approval.md`의 "폰(기기) 자격", 기기에 가는 event는 `event.md`가 맡는다.

## 문제

- 폰에서 일을 이어 가려면 desktop과 같은 대화·승인·Inbox 해석(ACP reducer, 승인·질문 card, 대기열, rewind)이 있어야 한다. 폰용으로 다시 짜면 같은 해석이 두 벌이 되어 고칠 때마다 맞춰야 한다.
- 폰 화면은 scroll, keyboard, gesture가 폰다워야 한다. desktop의 web 화면을 폰 WebView에 넣어 보았더니(계획 `phone-remote-web`) 폰답지 않았다. 컴퓨터가 화면을 내려주는 길(web bundle, hash 확인 cache, WebView, bridge)은 폰 껍데기를 무겁게 하고 폰에 없는 통로를 부르는 화면까지 끌고 왔다.
- 화면을 폰마다 맞춰 짜면 안 된다. 폭 320~430의 어느 폰에서나 맞아야 하고, 폭이 넓은 기기(접은 폰, tablet)에서도 깨지지 않아야 한다.
- 폰의 기기 key는 폰 안에만 있어야 하고, 화면 code가 그 key나 연결을 직접 만지지 않아야 한다.

## 목표와 비목표

- 목표: 사람이 승인한 wireframe대로 native 화면을 짓는다. 화면 아래의 로직(event client, Inbox store, 대화 source, 순수 reducer와 규칙)은 desktop과 같은 TypeScript를 쓰고 해석을 한 벌로 둔다. 화면 문구는 desktop과 같은 catalog를 쓴다. 컴퓨터 없이도 화면 모양을 볼 수 있다(sample 컴퓨터).
- 비목표: iOS build, push 알림과 잠금 화면, coding agent session 다루기, 사용자 앱의 폰 화면과 폰에서 도는 앱, 위젯(roadmap `mobile.md`의 뒤 단계). 폰에서 secret 넣기(보호 입력 창은 desktop의 것), 만들기·고치기·지우기(agent, job, 앱, project, workflow 정의), provider와 model 관리, skip 켜기, session 지우기. 폰의 권한은 보기, 말하기, 답하기(승인·질문·앱 update), 켜고 끄기, 지금 돌리기, 새 session이다.

## 모델

```
폰 앱 ──(Noise 연결, call/watch frame, direct나 relay)──▶ core remote listener
  │ 컴퓨터마다 연결 하나. 모양은 desktop의 CoreSource(subscribe, current, call, watch, onEvent)
  ▼
data 층: 컴퓨터 store → event client, Inbox store, 대화 source (desktop과 같은 로직)
  ▼
화면: 뼈대(sidebar + place의 stack) 안의 native 화면. 폰 UI kit 위에 선다
```

- **뼈대.** root는 컴퓨터가 하나도 없으면 연결 흐름(pairing)에서 시작하고, 있으면 frame이다. frame은 왼쪽 sidebar(drawer)와 그 옆 place의 stack이다. 아래 tab bar는 없다. 폭 600 이상이고 높이 480 이상이면 sidebar가 늘 열려 있고 stack은 그 옆 card에 든다. 가로로 든 폰은 폭이 넘어도 낮아서 drawer로 둔다. 화면 이동은 React Navigation(native stack과 drawer)이다.
- **갈 곳.** 앱 안의 모든 곳(Home, Search, Inbox, 앱 새 판 살펴보기, Jobs, Agents, workspace, workflow 실행, file, 대화, diff, 새 session, Settings)은 하나의 union(`Place`)으로 이름 짓는다. 화면은 곳을 직접 만들지 않고 그 곳을 열어 달라고 한다. place마다 화면이 하나 등록되어 있고 그 화면은 place를 인자로 받는다. sidebar는 컴퓨터(고르기), Search, Inbox(배지), Jobs, Agents, workspace(project와 앱)와 그 session, Settings를 보인다.
- **화면.** Home(session 목록, 컴퓨터가 offline일 때의 안내), Search(session, workflow, file, job, agent 한 칸), Inbox(Now: 답할 것, 앱 새 판 살펴보기. History는 notice 목록이다), 대화(보내기, 멈추기, 승인과 질문 card, 여러 답 질문, model·mode·이름 같은 sheet, 첨부, 파일 diff), 새 session(workspace와 agent 고르기), project workspace(session, workflow, file 목록과 글 file 읽기), 앱 workspace(실행 기록과 판), Jobs(목록, 켜고 끄기, 놓친 차례 Start now), Agents(목록과 상세), Settings(Computers, Appearance, About).
- **data 층.** 컴퓨터마다 연결 하나(`CoreSource`와 같은 모양이라 desktop 코드가 그대로 돈다) 위에 desktop과 같은 event client, Inbox store, 대화 source를 얹는다. 화면은 그 읽기 hook만 쓰고 연결을 만지지 않는다. 폰이 desktop에서 가져오는 것은 DOM과 Electron에 닿지 않는 순수 logic뿐이다. desktop file이 DOM kit이나 desktop 탭 type을 import해서 못 가져오는 순수 규칙(workflow 규칙, line diff)은 import가 깨끗한 file로 옮겨 둘이 같이 쓴다. 옮기지 못한 몇 곳은 폰이 베껴 쓴다(이슈 `phone-copies-desktop-pure-helpers`).
- **sample 컴퓨터.** dev build에서 환경 변수로 켜면 지어낸 data를 내는 컴퓨터가 목록에 든다. desktop gallery의 fake core를 같은 event client, store, hook으로 돌려 화면이 진짜 컴퓨터와 같은 모양을 받는다. 저장하지 않고 하는 일은 메모리만 바꾼다. 화면 모양은 sample로, 동작은 개발 core로 본다.
- **문구.** desktop과 같은 `@lophn/i18n` catalog다. desktop에 있는 문장은 그 key를 그대로 쓰고, 폰에만 있는 문장만 `mobile.`로 시작하는 key로 더한다. Hermes에는 `Intl.Segmenter`, `Intl.PluralRules`, `Intl.RelativeTimeFormat`이 없어 앱 시작 때 한 곳에서 영어 대체를 깐다(제목 한도의 글자 수를 code point로 세어 이모지 조합은 조금 길게 센다).
- **모양.** Appearance는 theme(시스템, light, dark)와 글 크기(small, default, large)를 이 폰의 보안 저장소에 둔다. 글 크기는 kit의 text scale 한 값으로 넘기고 화면마다 따로 고치지 않는다.
- **pairing.** 처음 열면 Welcome이다. Scan the code는 camera로 QR을 읽고, "Enter a pairing code instead"는 desktop Settings › Remote의 "Show as text"가 보이는 글(QR에 든 JSON)을 붙여 넣는다(camera가 없거나 허락하지 않은 폰, emulator). Pairing 화면이 `pair` frame으로 code와 폰 이름, OS, 화면 크기, DPR을 보내고 첫 연결이 열리기를 기다린다. Paired에서 사람이 이 폰에서 그 컴퓨터를 부를 이름("Shown as")을 확인한다. core는 자기 이름을 보내지 않아 이름을 안 정하면 주소로 부른다. 지났거나 이미 쓴 code는 Code expired, 닿지 않으면 Cannot reach 화면이다. 기기 key 쌍과 컴퓨터 목록(주소 후보, port, core key, relay 주소, 기기 id, 끊김 표시, 이름)은 보안 저장소(이 기기에서만, 잠금이 풀렸을 때만)에 둔다. 무작위는 `expo-crypto`다(Hermes에는 전역 crypto가 없다).
- **컴퓨터를 지우고 다시 pairing.** Settings에서 컴퓨터를 지울 때 그 컴퓨터에 붙어 있으면 `devices/unpair`로 컴퓨터의 자기 등록을 지우고 폰의 기록을 지운다. 닿지 않으면 폰만 잊는다. 컴퓨터는 그 폰의 key를 계속 알고 있지만 같은 key가 유효한 code로 `pair`하면 옛 등록을 새 등록으로 바꾸므로(`approval.md`) 같은 컴퓨터와 다시 pairing이 된다. 마지막 컴퓨터를 지우면 Welcome으로 돌아간다. 컴퓨터에서 기기를 끊어 `closed(credential_revoked)`를 받으면 그 컴퓨터를 "다시 pairing"으로 표시하고 다시 붙기를 멈춘다.
- **연결.** QR의 direct 주소 후보와 relay(QR에 있으면)를 같이 걸어 먼저 handshake가 된 것을 쓴다. relay 길은 바이트만 넘기므로 handshake와 그 뒤는 direct와 같다. relay를 더하기 전에 pairing한 폰은 한 번 다시 pairing해야 relay 주소를 안다. 붙을 때마다 마지막 `watch`(없으면 `[]`)를 보내고 core의 `ready`로 `ready`가 된다. 끊기면 1초에서 30초 backoff로 다시 붙는다. core가 protocol 오류로 연결을 닫은 뒤에도 다시 붙는다. 앱이 뒤로 가면 다시 붙기를 멈추고, 앞으로 오면 열린 연결에 `watch`를 다시 보내 3초 안에 `ready`가 없으면 버리고 바로 다시 붙는다. 틀린 조건(session id가 아닌 문자열 등)은 `watch`에 싣지 않는다. core가 그 조건을 이해하지 못하면 연결을 닫고, 새 연결이 마지막 `watch`를 다시 보내므로 폰이 영영 offline에 머문다. 컴퓨터 목록은 컴퓨터마다 상태(connecting, connected, offline, revoked)와 길(direct, relay), 그 컴퓨터 Inbox의 대기 수를 보인다.
- **폰 route 목록.** 기기가 부를 수 있는 route는 `approval.md`가 정한다. 폰 화면을 지으며 session·대화 쪽에 Agents, Jobs와 그 실행 기록, workflow, 앱 실행 기록과 release, project의 file 목록과 글 file 읽기(`project_files/list`, `project_files/read`)가 더해졌고, 기기가 부르는 `jobs/update`는 `{job, enabled}`만 받는다. 폰이 자기 등록을 지우는 `devices/unpair`가 목록의 유일한 기기 route다. 화면은 목록 밖 route를 부르는 단추를 보이지 않는다(Inbox에 job 거절이 없고 job 이름·때 고치기가 없다).
- **첨부.** 대화의 Add sheet는 Photos(Android 시스템 사진 선택기라 권한이 없다)와 Camera(권한을 묻고, 거절하면 이유와 설정으로 가는 길을 보인다)를 준다. 사진은 JPEG로 다시 인코딩해 보낸다. PNG, JPEG, GIF, WebP만이고 한 장 5 MiB까지다. 올릴 때는 desktop composer가 붙여 넣은 그림을 올리는 길 그대로 `message-images/upload`(바이트는 `call` 안 base64)를 부르고 받은 blob을 message의 image block에 싣는다. 사진만 있는 message도 보낼 수 있다. 컴퓨터가 offline이면 첨부를 잠근다. desktop은 컴퓨터의 path로 아무 file이나 붙이지만 폰의 file에는 컴퓨터의 path가 없어 그림만이다.
- **bytes.** frame은 JSON뿐이다. upload route는 `{input, base64}`로 보내고 file route의 답은 `{content_type, base64}`로 받는다. 한 file 8 MiB, frame 16 MiB 안이다.
- **폰 앱 package.** `mobile`은 root npm workspace 밖의 Expo project(SDK 58, dev build)다. Metro가 protocol, design(kit, i18n), desktop의 순수 logic file을 source로 읽고, 그 안의 bare import(zod, `@noble/*`)는 폰 앱의 `node_modules`에서 푼다. 연결(handshake, frame)은 좁은 입구 `@lophn/protocol/remote/client`로 쓴다. 명령과 개발 build는 그 package의 README에 있다.
- **개발.** `npm run dev:remote`는 개발 core(`.dev-data`)의 remote를 켜고(port 47432, 사람의 lophn과 겹치지 않게, relay는 비운다) pairing text(QR에 싣는 JSON)를 찍는다. 폰이나 emulator의 "Enter a pairing code instead" 칸에 붙여 넣는다. code는 5분, 한 번이다.

## 지키는 것

1. 폰이 부르는 route는 모두 기기 route 목록 안이다. 화면이 목록 밖 route를 부르는 단추를 보이지 않는다(skip 바꾸기, session 지우기, 설정·secret 화면, job 만들기·고치기·거절).
2. desktop 화면의 동작과 모양은 폰 때문에 바뀌지 않는다. desktop 화면에 폰을 위한 분기(prop, host member)가 없고, 폰은 desktop의 DOM·Electron 화면 file을 import하지 않는다. 폰이 가져오는 것은 순수 logic뿐이다.
3. 화면은 연결과 key를 직접 만지지 않는다. data 층의 읽기 hook만 쓴다.
4. 기기 key는 폰의 보안 저장소에만 있다.
5. 틀린 `watch` 조건은 보내지 않는다. 연결이 닫힌 뒤에는(사람이 끊은 것이 아니면) 다시 붙는다.
6. 폰이 컴퓨터를 지우면 그 폰의 기록이 지워지고 컴퓨터에 닿으면 컴퓨터의 등록도 지워진다. 닿지 않아도 같은 컴퓨터와 다시 pairing할 수 있다.
7. 폰 화면의 문구는 `@lophn/i18n`의 key다. 폰에만 있는 문장만 `mobile.`로 시작하는 새 key다.
8. relay는 증명하지 못한 control socket에 폰 연결을 잇지 않고, 폰 연결 둘의 message는 서로의 data socket으로 가지 않는다. relay는 내용을 보지 못한다(Noise는 폰과 core 사이에서 끝난다).

## 경계와 계약

- boundary `remote-protocol`: frame, 기기 route 목록(`devices/unpair`, `project_files/list|read` 포함), base64 bytes. 폰은 연결에 좁은 입구 `@lophn/protocol/remote/client`(연결, frame type, key, `REMOTE_PATH`, QR 해석 schema)를 쓰고, route 정의와 schema는 protocol source를 그대로 읽는다.
- boundary `mobile`: 폰 앱. boundary `design-native`: 폰 UI kit.
- 앱 안의 길: place union 하나. 화면은 `open(place)`, `back()`, sidebar 열기, 컴퓨터 고르기만 부른다.

## 결정

- 폰 화면은 컴퓨터가 내려주는 web 화면이 아니라 폰 UI kit으로 쓴 React Native 화면이다. 이유: scroll, keyboard, gesture가 폰답고, 화면 내려주기(bundle, hash 확인 cache, WebView, bridge)가 없어 폰 앱이 단순하다. 비교한 폰 앱 다섯 가운데 셋이 RN native였다. 버린 안: 얇은 껍데기와 core가 내려주는 web 화면(계획 `phone-remote-web`과 `phone-shell`이 만들었고 이번에 지웠다). (사람, 2026-11-15)
- wireframe이 화면의 기준이다. 뼈대는 sidebar이고 아래 tab bar를 두지 않는다. 폭 600 이상에서는 sidebar가 늘 열려 있다. (사람, 2026-11-15)
- 화면 이동은 React Navigation(native stack과 drawer)이다. 이유: 넓은 화면의 고정 sidebar가 들어 있고 비교한 폰 앱이 쓰는 표준이다. (agent, 2026-11-15)
- 폰의 권한은 보기, 말하기, 답하기, 켜고 끄기, 지금 돌리기, 새 session이다. 만들기·고치기·지우기와 secret, provider, model 관리는 컴퓨터에서 한다. 폰에서 mode(skip)를 바꾸지 않는다: skip은 agent가 사람에게 묻지 않고 돌게 하는 권한 설정이라 desktop에서 정한다(`approval.md`). (사람, agent)
- 화면 문구는 desktop과 같은 `@lophn/i18n` catalog에서 온다. 이유: 같은 문장이 두 벌이 되지 않는다. (사람, 2026-11-15)
- 화면 아래의 로직은 desktop과 같은 TypeScript(event client, Inbox store, 대화 source)를 그대로 쓴다. 이유: 대화 해석이 한 벌이어야 한다. 대가: DOM에 묶인 desktop file의 순수 부분을 DOM 없는 file로 옮겨야 한다. 옮기지 못한 것은 폰이 베낀다. (agent)
- 폰의 대화 화면은 desktop 대화 화면(`AgentView`)을 폰 host로 쓰지 않고 폰 kit으로 새로 그린다. 이유: desktop 화면은 DOM이고 desktop만의 통로(터미널, file 열기, 끌어 놓기, preload)를 끌고 온다. 대화 해석(source)만 공유한다. (agent)
- 화면을 core 없이 보도록 dev build에 sample 컴퓨터를 둔다. 이유: 화면 worker와 사람이 컴퓨터 없이 모양을 본다. (agent)
- 폰이 컴퓨터를 지울 때 `devices/unpair`로 자기 등록을 지우고, 컴퓨터가 이미 아는 key의 유효한 `pair`는 옛 등록을 바꾼다. 이유: 닿지 않을 때 폰만 잊으면 컴퓨터가 그 key를 계속 알아 같은 컴퓨터와 다시 pairing이 "Cannot reach"가 되었다. 버린 안: 폰이 지우기 전에 컴퓨터에서 먼저 끊게 하기(꺼져 있는 컴퓨터는 못 끊는다). (agent)
- 첨부는 사진(Photos, Camera)만이고 5 MiB, 그림 네 종류다. 이유: desktop과 같은 route와 message 모양을 쓰고, 폰의 file에는 컴퓨터의 path가 없다. 버린 안: 아무 file 첨부(file 고르기 module이 하나 더 들고 route가 없다). (agent)
- byte는 frame 종류를 늘리지 않고 `call` 안에 base64로 싣는다. 이유: 대화 이미지와 file은 작고, frame 종류를 늘리면 연결 계약이 커진다. (agent, 2026-11-15)
- 앞으로 온 앱은 열린 연결에 `watch`를 다시 보내 3초 안의 `ready`로 살아 있는지 본다. 이유: background에서 소리 없이 죽은 socket은 close event가 오지 않는다. 멀쩡한 연결은 `stale`로 깜빡이지 않는다. (agent, 2026-11-15)
- 폰 앱은 root workspace 밖의 `mobile`에 자기 `package.json`과 lock을 가진 Expo project로 둔다. 이유: React Native 의존 tree가 Electron 설치와 `npm run check`에 섞이지 않는다. protocol과 kit은 Metro가 source로 읽어 한 벌이다. 대가: 폰 앱의 type 검사와 test는 따로 돌린다(폰 앱 폴더의 `npm run typecheck && npm test`). (agent, 2026-11-15)
- 폰 UI kit은 지금 react-native-web이나 다른 runtime을 고려하지 않는다. 사용자 앱이 kit을 쓰는 길은 roadmap `mobile.md` 단계 6의 spike가 정한다. (agent)

## 열린 것

폰에 아직 없는 것과 알려진 빈틈은 이슈와 change-log `mobile-app`에 있다: 대화의 수식과 mermaid는 code box로 보인다, Deny에 이유를 쓰지 못한다, fork·rewind·subagent 열기가 없다, Inbox의 History는 notice 목록이다, agent 줄의 model은 raw 이름이다, folder가 여럿인 project는 첫 folder만 보인다.
