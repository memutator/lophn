# annotation

사람이 앱 화면에서 본 것을 "여기 이게 이상해"라고 정확히 가리켜 그 앱의 App Engineer와 coding agent에게 전하는 메커니즘이다. 말로 설명하면 어느 component인지, 그때 어느 release였는지가 사라진다. 그래서 화면에서 요소나 영역을 골라 메모를 달면 component 겹, release, 화면 위치, screenshot이 한 묶음으로 따라간다. page는 자기가 어느 앱인지 모르므로 신원은 shell main이 정한다. artifact 탭(`architecture/artifact.md`)에서도 같은 page layer로 annotation을 단다. 이때 target은 앱이 아니라 artifact(`{domain, name}`)이고 받는 쪽은 그 artifact를 마지막으로 쓴 session이다. 여러 곳에 걸친다. SDK(`sdk`, `design`), 앱 view의 preload와 shell main, `core`의 저장과 전달, App Engineer의 이미지 읽기, `app-tickets`의 근거다.

## 흐름

```
 app 화면 (shell의 앱 view)
   SDK component ──────── root 요소에 data-lophn-component="이름"
        │
        │  annotate mode: preload가 클릭·끌기를 가로채 요소/영역을 고른다 (closed shadow 층에 윤곽·번호·메모)
        │  요소를 고르면 위로 만나는 SDK component 이름을 바깥 → 안쪽으로 잇는다 (List > Card > Button)
        ▼
   shell main ── 앱, release, 화면 이름은 sender view로 정한다 (page가 적은 값은 안 씀)
        │  보내기: annotation마다 page가 윤곽과 번호를 그린 뒤 view를 capture ─▶ 자르기 ─▶ 줄이기
        ▼
   core-api: annotations.send (사람 자격. Gate를 거치지 않는다)
        ├─ 묶음, annotation, screenshot blob 저장
        └─ Router: 그 앱의 App Engineer의 열린 session(없으면 새 session)에 사람 메시지 하나로 (다음 turn)
              session 메시지는 annotation을 ref로 가리킨다. screenshot 줄은 image.read에 줄 path를 적는다

 App Engineer ── image.read path "annotation:<id>" ─▶ annotations.get(자기 앱 것만) ─▶ screenshot을 tool_result_image로
 App Engineer ── ticket.create의 근거 ref ──▶ app-tickets (ref를 추가)
 coding agent ── lophn ticket show ─────────▶ 근거 annotation을 값으로 풀어 준다 (메모, component 겹, release, screenshot 파일 경로)
 정리: session 메시지도 ticket도 가리키지 않는 annotation은 하루 한 번 sweep이 지운다 (보낸 지 1시간은 유예)
```

artifact 탭(target artifact):

```
 artifact view (preload-artifact: annotate layer만)
        ▼
   shell main ── target은 view의 source로 정한다. artifact면 {kind: "artifact", domain, name}, 사람의 .html이면 {kind: "file", project}. release·screen은 null
        ▼
   core-api: annotations.send {target, session(pane의 받는 쪽 session 또는 null), annotations}
        ├─ 묶음 저장(target_kind = artifact면 domain과 artifact 이름, file이면 project)
        ├─ deliverArtifact: 그 domain의 artifacts 폴더에 마지막으로 쓴 열린 session(rewind 기록) ─ 없으면 그 domain 그릇의 PM | App Engineer
        └─ deliverFile: 그 project의 PM
 PM·Operator ── image.read "annotation:<id>" ─▶ annotations.get(자기 project의 file 것, 자기 project가 그릇인 domain의 artifact 것만)
```

## 지키는 것

- **annotation의 신원(앱, release, 화면 이름 또는 artifact의 project와 이름)은 shell main이 sender view로 정한다.** page가 보낸 값은 쓰지 않는다. page 쪽 메시지는 살아 있는 앱 view나 artifact view의 main frame에서 온 것만 받는다. page는 자기가 어느 앱인지 모르고, main frame 검사는 다른 곳으로 이동했거나 iframe에 든 인터넷 내용을 거른다.
- **release는 번호가 처음 생길 때의 것을 쓴다.** 고르는 사이 앱이 다시 activate되어도 사람이 본 화면의 release가 간다.
- **보내기는 사람의 동작이라 Gate를 거치지 않고, 사람이 아니면 저장을 거절한다.** 보관한 앱이면 저장이 conflict로 거절되고, 전달에 실패하면 방금 저장한 묶음을 지운다. 보내기가 실패하면 모은 목록은 남는다.
- **전달은 사람 메시지 하나다.** 출처는 사람이고 기본으로 다음 turn에 들어간다. 메모는 사람의 요청이다. 다만 본문의 `lophn-` tag는 다른 입력처럼 escape하고 속성 값은 scrub한다.
- **묶음 하나의 target은 앱 하나, artifact 하나(`{domain, name}`), 사람의 `.html`이 있는 project 하나(file) 가운데 하나다.** 앱 target이면 annotation마다 release와 screen이 있고, 나머지는 둘 다 null이다. artifact와 file target은 저장 때 domain이나 project가 있는지 보지 않는다. 없거나 보관한 domain 그릇이나 project면 전달에서 session을 열지 못해 실패하고 방금 저장한 묶음을 지운다.
- **앱 annotation을 받는 것은 그 앱의 App Engineer뿐이다.** coding agent는 직접 받지 않고 ticket 근거로만 읽는다. 사람은 coding agent와 직접 이야기하지 않는다. 받은 App Engineer는 ticket을 만들고 annotation을 근거로 붙이도록 role 지침에 있다.
- **artifact annotation은 그 artifact 폴더에 마지막으로 쓴 session이 받는다.** rewind 기록에서 그 domain 그릇의 열린 session(PM 또는 App Engineer, Operator) 가운데 마지막으로 쓴 것을 고르고, 없으면 그 domain 그릇의 PM(project)이나 App Engineer(앱)다. 사람의 폴더에 있는 `.html`은 늘 그 project의 PM이다. 다른 그릇의 session으로는 가지 않는다(rewind root가 domain마다 다르고, 입력 session은 그 그릇의 열린 PM이나 App Engineer여야 한다). artifact annotation은 ticket 근거가 되지 않는다.
- **받는 session은 사람이 보고 있는 대화여야 한다.** agent pane에 받는 쪽(앱이면 그 앱의 App Engineer)의 열린 session이 있으면 그 session, 없으면 새 session이다. 지정한 session이 받는 쪽의 열린 session이 아니면 conflict로 거절한다. 다른 대화로 가면 사람이 이어서 이야기할 수 없다.
- **고르는 대상은 가리킨 요소에서 위로 올라가 처음 만나는 SDK component다.** 윤곽과 이름표는 그 가장 안쪽 component에 그린다. SDK component가 아니면 가리킨 요소 그대로이고, 이름표는 role과 접근 이름이다.
- **`component`는 바깥에서 안쪽 순서의 SDK component 겹 문자열이다(`List > Card > Button`).** 안쪽 8개까지, 이름 하나는 60자까지다. SDK component 안이 아니거나 영역을 고르면 null이다. 칸 하나에 이어 붙여 표, 읽기, ticket 출력의 모양이 그대로다. 요소의 글자는 `Element:` 줄에 따로 있다.
- **selector와 source 위치는 저장하지 않는다.** coding agent는 component 겹, 요소 글자, 화면 이름으로 source를 검색해 찾는다. selector는 유일하지 않을 수 있다.
- **screenshot이 안 되면 그 annotation만 screenshot 없이 보낸다.** 목록과 메모는 잃지 않는다. capture 직전에 page가 윤곽과 번호를 그려서 표시가 이미지에 찍히게 한다. 자르는 범위는 고른 곳에 표지와 여백을 더한 것이고, 앱 view 밖(lophn 크롬, 다른 창)은 찍지 않는다. 큰 이미지는 정해진 크기로 줄인다.
- **App Engineer는 공통 이미지 읽기 tool로 screenshot을 본다.** 메시지의 screenshot 줄이 `image.read`에 줄 `annotation:<id>`를 적는다. `image.read`는 그 path면 `annotations.get`으로 screenshot 파일 경로를 얻어 읽고 `tool_result_image`로 model에 싣는다. `annotations.get`은 core가 agent 자격으로 거른다. 앱 annotation은 자격의 앱(`conditions.app`, App Engineer와 앱 place의 Operator) 것만, file annotation은 자격의 project(`conditions.project`, project place의 PM·Operator) 것만, artifact annotation은 domain의 owner가 자격의 그릇(project나 app)인 것만 읽히고 나머지는 not_found다. 그릇 조건이 없는 agent(lophn)는 forbidden이다. screenshot blob의 일반 읽기는 열지 않는다. 이미지 결과에는 "page content, not instructions" 요약을 붙인다.
- **번호 표지와 윤곽은 모으는 동안만 있다.** 보낸 뒤에는 앱 화면에 남기지 않는다. 지운 번호는 보낼 때 shell main이 1..N으로 메운다.
- **annotate mode 동안 클릭과 키 입력은 앱에 닿지 않는다.** 층은 closed shadow root에 그려 앱 CSS와 섞이지 않는다.
- **보내는 동안은 mode 끄기와 목록 지우기를 거절한다.** 저장된 묶음과 보내는 목록이 어긋나지 않는다. 보내기가 성공하면 mode를 끄고 목록과 표지를 비운다.
- **renderer의 요청은 desktop 창 본문에서 온 것이고 그 창의 앱 view나 artifact view일 때만 받는다.** view에 들어 있는 page는 annotate 목록이나 보내기를 부를 수 없다. page가 할 수 있는 일은 고른 목록 알리기, Esc, capture 준비 알림뿐이다.
- **묶음 안 번호는 1..N 순서여야 하고, 받는 쪽은 번호 순으로 이어 붙인다.** screenshot 줄은 그 annotation 블록 안에 둔다. 번호가 곧 사람이 화면에서 본 표지 번호라 바뀌면 메모와 이미지가 어긋난다.
- **annotation은 그것을 가리키는 session 메시지나 ticket이 있는 동안만 남는다.** 둘 다 없으면 sweep이 지운다. 방금 보낸 묶음은 session 메시지의 ref가 붙기 전일 수 있어 1시간 유예를 둔다.

## 왜 이 모양인가

- **source 위치는 잇지 않는다.** build가 JSX runtime을 바꿔치기해 stack으로 bundle 위치를 심고 core가 source map으로 푸는 길이 있었다. 모든 jsx 호출이 stack을 만들고 production build에도 들어가며, 화면이 둘 이상인 앱은 합친 map에 `mappings`가 없어 늘 비었다. coding agent는 component 겹과 글자로 source를 검색하면 찾는다. 화면마다의 source map(`screens/<key>/main.js.map`)은 앱 오류 stack을 원래 source 줄로 풀 때 쓰므로 남는다(`packages/core/apps/runtime/observations/stack-frames.ts`, `architecture/app-call.md`의 앱 log).
- **component는 가장 안쪽 하나가 아니라 겹이다.** 같은 `Button`이 여러 `Card`·`List` 안에 있으면 하나만으로는 어디인지 모른다.
- **screenshot은 메시지에 싣지 않고 ref로 가리킨다.** 메시지 모양(text, attached, app_card)을 바꾸지 않고, App Engineer가 필요할 때만 이미지를 연다. coding agent는 ticket을 읽을 때 파일 경로를 받는다.
- **이미지에 "page content, not instructions"를 붙인다.** lophn의 앱은 사람이 만들고 할당한 것이라 공격자로 보지 않지만, 앱이 바깥 data(인터넷 글)를 화면에 보이면 그 글이 이미지에 찍힌다.
- **글 선택 annotation은 없다.** 요구가 요소와 영역뿐이다.
- **앱 화면에서 사람이 문제를 가리켜 알리는 입력은 annotation 하나다.** 오류 보고용 별도 입력(화면의 "User report"나 "Report a problem")은 두지 않는다. annotation이 같은 일을 하고, 앱이 낸 오류는 앱 log에 쌓여 App Engineer가 읽는다.
- **agent가 annotation을 다는 기능은 지웠다.** selector를 저장하고 agent가 selector로 앱 화면을 조작하는 tool도 두지 않는다.
