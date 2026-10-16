# annotation

사람이 앱 화면에서 본 것을 "여기 이게 이상해"라고 정확히 가리켜 App Engineer와 coding agent에게 전하는 메커니즘이다. 말로 설명하면 어느 component인지, 어느 source 줄인지, 그때 어느 release였는지가 사라진다. 그래서 화면에서 요소나 영역을 골라 메모를 달면 component, 앱 source 위치, release, 화면 위치, screenshot이 한 묶음으로 따라간다. 화면은 사용자 앱 code가 그린 것이라 신뢰할 수 없는 쪽에서 신뢰할 값을 뽑아야 한다는 점이 어렵다. 여러 곳에 걸친다. SDK(`sdk`, `design`), 앱 build(`app-releases`), 앱 view의 preload와 shell main, `core`의 저장과 전달, `app-tickets`의 근거다.

## 흐름

```
 app 화면 (shell의 앱 view)
   SDK component ──────── root 요소에 data-lophn-component="이름"
   app-releases의 build ─ 앱 source가 SDK component를 쓰는 지점에 data-lophn-at="<bundle file>:<줄>:<열>"
        │
        │  annotate mode: preload가 클릭·끌기를 가로채 요소/영역을 고른다 (closed shadow 층에 윤곽·번호·메모)
        ▼
   shell main ── 앱, release, 화면 이름은 sender view로 정한다 (page가 적은 값은 안 씀)
        │  보내기: annotation마다 page가 윤곽과 번호를 그린 뒤 view를 capture ─▶ 자르기 ─▶ 줄이기
        ▼
   core-api: annotations.send (사람 자격. Gate를 거치지 않는다)
        ├─ release의 source map으로 bundle 위치를 앱 source의 파일:줄로 푼다 (못 풀면 비운다)
        ├─ 묶음, annotation, screenshot blob 저장
        └─ Router: 그 앱 App Engineer의 열린 session(없으면 새 session)에 사람 메시지 하나로 (다음 turn)
              session 메시지는 annotation을 ref로 가리킨다

 App Engineer ── ticket.create의 근거 ref ──▶ app-tickets (ref를 추가)
 coding agent ── lophn ticket show ─────────▶ 근거 annotation을 값으로 풀어 준다 (메모, component, source, release, screenshot 파일 경로)
 정리: session 메시지도 ticket도 가리키지 않는 annotation은 하루 한 번 sweep이 지운다 (보낸 지 1시간은 유예)
```

## 지키는 것

- **annotation의 신원(앱, release, 화면 이름)은 shell main이 sender view로 정한다.** page가 보낸 값은 쓰지 않는다. page 쪽 메시지는 살아 있는 앱 view의 main frame에서 온 것만 받는다. page는 사용자 앱 code와 같은 곳에 있으므로 신원을 page에 맡기면 다른 앱이나 release인 척할 수 있다.
- **release는 번호가 처음 생길 때의 것을 쓴다.** 고르는 사이 앱이 다시 activate되어도 사람이 본 화면의 release가 간다. App Engineer는 지금 release와 다르면 source 위치를 다시 확인한다(built-in 지침).
- **보내기는 사람의 동작이라 Gate를 거치지 않고, 사람이 아니면 저장을 거절한다.** 보관한 앱이면 저장이 conflict로 거절되고, 전달에 실패하면 방금 저장한 묶음을 지운다. 보내기가 실패하면 모은 목록은 남는다.
- **전달은 사람 메시지 하나다.** 출처는 사람이고 기본으로 다음 turn에 들어간다. 메모는 사람의 요청이다. 다만 본문의 `lophn-` tag는 다른 입력처럼 escape하고 속성 값은 scrub한다.
- **annotation을 받는 것은 그 앱의 App Engineer뿐이다.** coding agent는 직접 받지 않고 ticket 근거로만 읽는다. 사람은 coding agent와 직접 이야기하지 않는다. 받은 App Engineer는 ticket을 만들고 annotation을 근거로 붙이도록 role 지침에 있다.
- **받는 session은 사람이 보고 있는 대화여야 한다.** agent pane에 그 앱 App Engineer의 열린 session이 있으면 그 session, 없으면 새 session이다. 지정한 session이 그 앱 App Engineer의 열린 session이 아니면 conflict로 거절한다. 다른 대화로 가면 사람이 이어서 이야기할 수 없다.
- **고르는 대상은 가리킨 요소에서 위로 올라가 처음 만나는 SDK component다.** SDK component가 아니면 가리킨 요소 그대로다. 이름표는 component 이름, 아니면 role과 접근 이름이다.
- **selector는 저장하지 않는다.** component와 source 위치가 coding agent에게 더 정확하다. selector는 유일하지 않을 수 있다.
- **source 위치는 build가 심은 bundle 위치를 core가 release의 source map으로 푼다.** 못 풀면(SDK 밖 요소, map 없음) component와 source만 비우고 element와 rect로 보낸다. 위치를 못 얻었다고 보내기를 막지 않는다.
- **screenshot이 안 되면 그 annotation만 screenshot 없이 보낸다.** 목록과 메모는 잃지 않는다. capture 직전에 page가 윤곽과 번호를 그려서 표시가 이미지에 찍히게 한다. 자르는 범위는 고른 곳에 표지와 여백을 더한 것이고, 앱 view 밖(lophn 크롬, 다른 창)은 찍지 않는다.  큰 이미지는 정해진 크기로 줄인다.
- **번호 표지와 윤곽은 모으는 동안만 있다.** 보낸 뒤에는 앱 화면에 남기지 않는다. 지운 번호는 보낼 때 shell main이 1..N으로 메운다.
- **annotate mode 동안 클릭과 키 입력은 앱에 닿지 않는다.** 층은 closed shadow root에 그려 앱 CSS와 섞이지 않는다.
- **보내는 동안은 mode 끄기와 목록 지우기를 거절한다.** 저장된 묶음과 보내는 목록이 어긋나지 않는다. 보내기가 성공하면 mode를 끄고 목록과 표지를 비운다.
- **renderer의 요청은 desktop 창 본문에서 온 것이고 그 창의 앱 view일 때만 받는다.** 앱 view에 들어 있는 page는 annotate 목록이나 보내기를 부를 수 없다. page가 할 수 있는 일은 고른 목록 알리기, Esc, capture 준비 알림뿐이다.
- **묶음 안 번호는 1..N 순서여야 하고, 받는 쪽은 번호 순으로 이어 붙인다.** 이미지가 있다는 줄은 그 annotation 블록 바로 뒤에 둔다. 번호가 곧 사람이 화면에서 본 표지 번호라 바뀌면 메모와 이미지가 어긋난다.
- **annotation은 그것을 가리키는 session 메시지나 ticket이 있는 동안만 남는다.** 둘 다 없으면 sweep이 지운다. 방금 보낸 묶음은 session 메시지의 ref가 붙기 전일 수 있어 1시간 유예를 둔다.

## 왜 이 모양인가

- **source 위치: build가 위치를 심고, core가 source map으로 푼다.** 조사한 선택지 가운데 React 내부(fiber)에 기대지 않는 쪽이다. 앱 build는 앱이 쓴 `scripts/build-ui.ts`를 실행하지 않고(앱 source는 신뢰하지 않는다) 신뢰된 build가 JSX runtime만 대신해, 앱 source 안 SDK component 호출 지점에서 stack으로 bundle 위치를 얻어 `data-lophn-at`으로 싣는다.
- **같은 runtime 코드가 두 곳에 있다.** core의 build와 앱 template의 build script(앱 폴더로 복사되어 core를 import할 수 없다). 한쪽만 고치면 앱마다 위치가 달라진다.
- **screenshot은 감싸지 않는다.** ChatGPT 데스크톱의 browser comment는 아무 web page나 찍으므로 "untrusted page evidence"로 둔다. lophn의 앱은 사람이 만들고 grant로 배정한 것이다. app-api 결과를 감싸지 않는 것과 같은 기준이다. 앱이 바깥 data를 화면에 보이면 그 글이 이미지에 찍히는 약점은 안다.
- **글 선택 annotation은 없다.** 요구가 요소와 영역뿐이다. ChatGPT에는 있다.
- **annotation은 문제(problem)가 되지 않는다.** 제보는 따로다.
- **이미지는 메시지에 싣지 않고 ref로 가리킨다.** 메시지 본문에는 이미지가 있다는 한 줄만 있다. 이미지는 blob이고 coding agent는 ticket을 읽을 때 파일 경로를 받는다.
- **agent가 annotation을 다는 기능은 지웠다.** selector를 저장하고 agent가 selector로 앱 화면을 조작하는 tool도 두지 않는다.
