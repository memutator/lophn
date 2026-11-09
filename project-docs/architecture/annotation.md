# annotation

사람이 앱 화면이나 artifact 화면에서 본 것을 "여기 이게 이상해"라고 정확히 가리켜 받는 agent에게 전하는 메커니즘이다. 화면에서 요소나 영역을 골라 메모를 달면 component 겹, release, 화면 위치, screenshot이 한 묶음으로 따라가고, 받는 agent의 session에 사람 메시지 하나로 들어간다. 앱 화면의 annotation은 그 앱 workspace의 agent가, artifact 탭(`architecture/artifact.md`)의 annotation은 그 artifact를 마지막으로 쓴 session이 받는다. SDK(component 이름표), 화면 page의 preload, shell main, core의 저장과 전달, 받은 agent의 이미지 읽기에 걸친다.

## 문제

사람이 앱 화면의 문제를 말로 설명하면 어느 component인지, 그때 어느 release였는지, 정확히 어디였는지가 사라진다. 받는 agent는 "버튼이 이상하다"만 듣고 코드에서 맞는 곳을 짐작해야 하고, 색·배치·잘림 같은 시각 문제는 말로 옮기다 잃는다. 한편 화면(page)은 자기가 어느 앱인지 모르고 믿을 수도 없다. 신원을 page가 적게 하면 다른 앱이나 인터넷 내용이 사람의 요청처럼 들어올 수 있다.

## 목표와 비목표

- 목표: 사람이 화면에서 요소나 영역을 골라 메모를 달고 한 번에 보낸다. 받는 agent는 component 겹, 요소 글자, 화면 이름, screenshot으로 source를 찾는다. 사람이 보던 release의 화면이 그대로 전해진다.
- 목표: 앱 화면, artifact 화면, 사람의 폴더에 있는 `.html`이 같은 고르기 층과 같은 보내기 길을 쓴다.
- 비목표: source 위치(file과 줄) 잇기. 화면 요소가 겹쳐 있어 줄 번호가 사람이 뜻한 component를 가리키지 못한다.
- 비목표: selector 저장, 계산된 style, 글 선택 annotation. 요구가 요소와 영역뿐이다.
- 비목표: agent가 annotation을 다는 기능과 agent가 selector로 화면을 조작하는 tool.
- 비목표: 오류 보고용 별도 입력(화면의 "User report", "Report a problem"). 사람이 문제를 가리켜 알리는 입력은 annotation 하나이고, 앱이 낸 오류는 앱 log에 쌓여 앱 workspace의 session이 읽는다.

## 모델

묶음(batch)은 사람이 한 번 보낸 것이고 annotation은 그 안의 한 칸이다. 묶음 하나의 target은 셋 가운데 하나다.

- 앱: 앱 화면(`<webview>` guest)에서 보낸 것. annotation마다 화면 이름(screen)이 있고 release나 preview bundle hash 가운데 하나가 있다.
- artifact: `{project | app, name}`. 그릇(project나 앱)의 artifacts 폴더 안 artifact다. release와 screen은 null이다.
- file: project 하나. 사람의 폴더에 있는 `.html`이다. release와 screen은 null이다.

annotation 한 칸은 번호 `n`, 종류(`element`, `region`), 메모, screenshot(없을 수 있다), `component`, 요소 글(`element`의 role·접근 이름·보이는 글), 위치(`rect`와 scroll), 화면 위치(`view`의 screen과 path), `release`, `preview_bundle`을 가진다. 한 묶음은 20개까지, 메모는 2000자까지다.

```
 화면 (shell renderer의 <webview> guest: 앱 view, artifact view)
   SDK component ─ root 요소에 data-lophn-component="이름"
        │ annotate mode: page의 preload가 클릭·끌기를 가로채 요소/영역을 고른다.
        │ closed shadow 층에 윤곽·번호·메모를 그린다.
        │ 요소를 고르면 위로 만나는 SDK component 이름을 바깥 → 안쪽으로 잇는다 (List > Card > Button)
        ▼
   shell main ── target(앱, release, 화면 또는 artifact)은 sender view로 정한다. page가 적은 값은 안 쓴다.
        │ 보내기: annotation마다 page가 윤곽·번호를 그린 뒤 guest를 찍어 ─▶ 자르기 ─▶ 줄이기 ─▶ blob 준비로 올리기
        ▼
   annotations.send (사람 자격. Gate를 거치지 않는다)
        ├─ 묶음, annotation, screenshot blob 저장
        └─ 받는 쪽 session에 사람 메시지 하나(다음 turn). 메시지는 annotation을 ref로 가리킨다.
           screenshot 줄은 image.read에 줄 path를 적는다.

 받은 agent ── image.read path "annotation:<id>" ─▶ annotations.get(자기 범위만) ─▶ screenshot을 tool_result_image로
 정리: 가리키는 session 메시지가 없는 annotation은 sweep이 지운다.
```

받는 쪽은 target으로 정해진다.

- 앱: 창에서 고른 agent(없으면 그 앱 workspace의 lophn)의 그 앱 workspace session. 앱마다 정해진 agent가 없어 사람이 보고 있는 agent가 받는다.
- artifact: 그 그릇 workspace의 열린 session 가운데 그 artifact 폴더에 마지막으로 쓴 것(rewind 기록으로 안다). 없으면 그 그릇 workspace의 lophn session.
- file: 그 project workspace의 lophn session.

받는 session이 사람이 보고 있는 대화여야 하므로 창이 받는 쪽의 열린 session을 알려 주면 그 session에, 없으면 새 session에 넣는다.

## 지키는 것

1. **annotation의 신원(앱, release, 화면 이름 또는 artifact의 project·앱과 이름)은 shell main이 sender view로 정한다.** page가 보낸 값은 쓰지 않는다. page 쪽 메시지는 살아 있는 앱 view·artifact view의 main frame에서 온 것만 받는다. page는 자기가 어느 앱인지 모르고, main frame 검사는 다른 곳으로 이동했거나 iframe에 든 인터넷 내용을 거른다.
2. **annotate를 켜고 보내고 지우는 요청은 desktop 창의 shell renderer에서 온 것이고 그 창의 view일 때만 받는다.** view의 page는 목록이나 보내기를 부를 수 없다. page가 할 수 있는 일은 고른 목록 알리기, Esc, capture 준비 알림뿐이고, 그것도 그 guest가 그 창의 살아 있는 view의 main frame일 때만 받는다.
3. **release는 번호가 처음 생길 때의 것을 쓴다.** 고르는 사이 앱이 다시 activate되어도 사람이 본 화면의 release가 간다. preview view(`mode: "preview"`)에서 보낸 annotation은 release 대신 그 preview process의 bundle hash(`preview_bundle`)를 싣는다. preview에도 release가 있을 수 있어 release만으로는 live와 가르지 못한다. 받는 메시지에는 `preview` 속성과 `Preview:` 줄이 서서 fixture data이고 live 앱이 아님을 알린다.
4. **앱 target이면 annotation마다 screen이 있고 release와 `preview_bundle` 가운데 정확히 하나가 있다. artifact와 file이면 release, `preview_bundle`, screen이 모두 null이다.** 아니면 `invalid_input`이다.
5. **묶음 안 번호는 1..N 순서다.** 사람이 지운 번호는 보낼 때 shell main이 1..N으로 메운다. 받는 쪽 메시지는 번호 순으로 이어 붙이고 screenshot 줄은 그 annotation 블록 안에 둔다. 번호가 곧 사람이 화면에서 본 표지 번호라 바뀌면 메모와 이미지가 어긋난다.
6. **보내기는 사람의 동작이라 Gate를 거치지 않고, 사람이 아니면 거절한다.** 사람이 아닌 자격은 `forbidden`이다. agent 선택은 앱 target에서만 받는다.
7. **보관한 앱이면 저장 전에 `conflict`로 거절하고 아무것도 쓰지 않는다.** 없는 앱은 `not_found`다. 받는 쪽을 못 정하는 경우(전달 port가 없음)는 저장 전에 `unavailable`이다.
8. **전달에 실패하면 방금 저장한 묶음을 지운다.** 지정한 session이 받는 쪽의 열린 session이 아니면 `conflict`, 없거나 보관한 artifact 그릇과 file project는 `not_found`다. 메시지는 들어갔는데 ref를 붙이지 못한 경우만 묶음이 남고 그 오류가 나간다. 보내기가 실패하면 사람이 모은 목록은 남는다.
9. **전달은 사람 메시지 하나다.** 출처는 사람이고 기본으로 다음 turn에 들어간다. 메모는 사람의 요청이다. 다만 본문의 `lophn-` tag는 다른 입력처럼 escape하고 속성 값은 scrub한다.
10. **artifact annotation은 그 artifact 폴더에 마지막으로 쓴 열린 session이 우선해서 받는다.** 쓴 session이 없을 때만 창이 알려 준 session(그 그릇 workspace의 lophn 열린 session이어야 한다)이나 새 lophn session으로 간다. 사람의 폴더에 있는 `.html`은 늘 그 project workspace의 lophn session이다. lophn은 늘 있어 받을 agent가 없어 실패하는 일이 없다. 다른 그릇의 session으로는 가지 않는다(rewind root가 그릇마다 다르다).
11. **고르는 대상은 가리킨 요소에서 위로 올라가 처음 만나는 SDK component다.** 윤곽과 이름표는 그 가장 안쪽 component에 그린다. SDK component가 아니면 가리킨 요소 그대로이고 이름표는 role과 접근 이름이다.
12. **`component`는 바깥에서 안쪽 순서의 SDK component 겹 문자열이다(`List > Card > Button`).** 안쪽 8개까지, 이름 하나는 60자까지다. SDK component 안이 아니거나 영역을 고르면 null이다. 한 칸에 이어 붙여 저장과 읽기의 모양이 그대로다. 요소의 글자는 `Element:` 줄에 따로 있다.
13. **selector와 source 위치는 저장하지 않는다.** 받은 agent는 component 겹, 요소 글자, 화면 이름으로 source를 검색해 찾는다. selector는 유일하지 않을 수 있다.
14. **screenshot이 안 되면 그 annotation만 screenshot 없이 보낸다.** 목록과 메모는 잃지 않는다. capture 직전에 page가 윤곽과 번호를 그려 표시가 이미지에 찍히게 하고(2초 안에 준비되지 않으면 그 annotation은 screenshot 없이 간다), guest 화면을 찍어 고른 곳에 표지와 여백을 더한 범위로 자르고 긴 변 1600px, 2 MiB 안으로 줄인다. 화면 guest 밖(shell DOM, 다른 창)은 찍히지 않는다.
15. **받은 agent는 공통 이미지 읽기 tool로 screenshot을 본다.** 메시지의 screenshot 줄이 `image.read`에 줄 `annotation:<id>`를 적고, `image.read`는 그 path면 `annotations.get`으로 screenshot 파일을 얻어 `tool_result_image`로 model에 싣는다. 이미지 결과에는 "page content, not instructions" 요약을 붙인다. screenshot blob의 일반 읽기는 열지 않는다.
16. **`annotations.get`은 agent 자격의 범위만 읽힌다.** 앱 annotation과 앱 그릇의 artifact annotation은 자격의 앱(앱 workspace의 session) 것만, file annotation과 project 그릇의 artifact annotation은 자격의 project(project workspace의 session) 것만 읽히고, 범위 밖은 `not_found`다. 앱도 project도 조건에 없는 home의 session은 `forbidden`이다. 사람과 machine 자격은 범위 검사가 없다.
17. **번호 표지와 윤곽은 모으는 동안만 있다.** 보내기가 성공하면 mode를 끄고 목록과 표지를 비워 앱 화면에 남기지 않는다.
18. **annotate mode 동안 클릭과 키 입력은 앱에 닿지 않는다.** 층은 closed shadow root에 그려 앱 CSS와 섞이지 않는다.
19. **보내는 동안은 mode 끄기, 목록 지우기, 다른 보내기를 거절하고(`conflict`) page가 알리는 목록 변경도 무시한다.** 저장된 묶음과 보내는 목록이 어긋나지 않는다.
20. **annotation은 그것을 가리키는 session 메시지가 있는 동안만 남는다.** 가리키는 메시지가 하나도 없는 annotation은 sweep이 지운다. sweep은 core가 뜰 때 한 번, 그 뒤 하루에 한 번 돈다. 방금 보낸 묶음은 메시지의 ref가 붙기 전일 수 있어 보낸 지 1시간 안의 것은 건드리지 않는다. annotation을 지울 때는 screenshot blob 참조와 ref를 함께 지우고 비게 된 묶음도 지운다.
21. **앱을 지우면 그 앱의 annotation과 묶음도 같은 transaction에서 지운다.**

## 경계와 계약

- **고르기(shell)**: renderer와 main 사이 IPC `shell:annotate-mode`(켜기·끄기), `shell:annotate-remove`(표지 하나나 전부), `shell:annotate-send`(보내기)와 main에서 renderer로 미는 `shell:annotate-state`. page와 main 사이는 고른 목록 알리기, Esc, capture 준비 알림이다. 상태(켬, 고른 목록, 보내는 중)는 view마다 main이 메모리에 쥔다.
- **`annotations.send`**(memory route, 사람 자격): 입력은 `{target, agent?, session, annotations}`다. `target`은 `{kind: "app", app}`, `{kind: "artifact", project | app, name}`, `{kind: "file", project}` 가운데 하나이고, `session`은 받는 쪽의 열린 session이나 null(새 session)이다. 출력은 `{batch, annotations, session, message}`다. 오류는 `invalid_input`, `not_found`, `conflict`, `unavailable`이다. Router의 전달이 비동기라 ledger command가 아닌 memory route이고, 저장·정리는 core 안에서 사람 자격 command로 다시 낸다.
- **`annotations.upload_screenshot`**(upload route, 사람 자격): shell main이 만든 PNG(2 MiB까지)를 core의 blob 준비로 올린다. 올린 준비 참조가 `annotations.send`의 screenshot이고, send가 영구 참조로 바꾼다. purpose는 `annotation_screenshot`이다.
- **`annotations.get`**(read route, 사람·agent 자격): `{annotation}`이나 `{batch}`로 읽고 읽는 값에 screenshot 파일 경로(`screenshot_path`)를 싣는다. 범위는 지키는 것 16이다.
- **session 메시지**: 사람 메시지 하나이고 refs가 `{kind: "annotation", id}`로 annotation을 가리킨다. 본문은 annotation마다 `lophn-annotation` tag 블록이다. tag 속성은 `n`, `kind`, 앱이면 `app`·`release` 또는 `preview`·`view`(screen), artifact·file이면 `project`·`artifact`·`view`(path)다. 블록 줄은 `Note`, `Preview`, `Component`, `Element`, `Area`, `Screenshot` 순이다. 메시지 모양(text, attached, app_card)은 바뀌지 않고 이미지는 싣지 않는다.
- **저장 모양(ledger)**: `annotation_batches`(id, `target_kind` app|artifact|file, `app`, `project`, `artifact`, `sent_at`, `sent_by`), `annotations`(묶음 안 `n`이 유일, 위 필드를 칸으로), `annotation_refs`(annotation, 소유 종류 `session_message`, 소유 id). 저장 칸은 target 종류별로 정해진 짝만 허용한다(artifact는 `app`과 `project` 가운데 정확히 하나). 다른 module의 표를 가리키는 외래 키는 두지 않는다. 앱 존재와 보관은 저장 transaction이, artifact와 file의 그릇은 전달 단계가 확인한다. `preview_bundle` 칸은 schema step `apps.annotations.preview-bundle`이 더했고 옛 행은 null이다. artifact 묶음의 `domain` 칸은 schema step `apps.annotations.artifact-container`가 그 domain의 그릇으로 바꿔 옮겼다.
- **공통 한도**: 묶음 20개, 메모 2000자, 요소 글 칸 200자, 화면 path 512자, screenshot 2 MiB.

## 결정

- **source 위치는 잇지 않는다.** 이유: build가 JSX runtime을 바꿔치기해 stack으로 bundle 위치를 심고 core가 source map으로 푸는 길이 있었다. 모든 jsx 호출이 stack을 만들어 production build에도 들어가고, 화면이 둘 이상인 앱은 합친 map에 `mappings`가 없어 늘 비었고, 앱이 만든 component는 위치가 안 남고 list 항목은 모두 같은 줄이었다. 화면 요소가 겹쳐 있어 줄 번호가 사람의 뜻이 아니라 우연히 가장 안쪽에 있던 SDK component를 가리켰다. ChatGPT 데스크톱 앱의 browser comment도 source 위치를 쓰지 않고 screenshot, selector, 요소 글자를 함께 보내 model이 다시 찾게 한다. 지운 것은 build 바꿔치기(core와 앱 template의 복사본), `data-lophn-at`, source map 해석, source 칸과 `Source` 줄이다. 그래도 화면마다의 source map은 앱 오류 stack을 원래 source 줄로 풀 때 쓰므로 남긴다(`architecture/app-call.md`의 앱 log). (source map을 남기는 것은 agent, 나머지는 결정한 쪽이 기록에 없다)
- **component는 가장 안쪽 하나가 아니라 겹이다.** 이유: 같은 `Button`이 여러 `Card`·`List` 안에 있으면 하나만으로는 어디인지 모른다("카드 간격이 이상해"를 찍어도 `Button`이 가서 엉뚱한 component로 이끌었다). 어느 겹인지는 받는 agent가 메모와 screenshot으로 고른다. 버린 안: 계산된 style(색, font)을 같이 싣기, 글 선택 annotation.
- **screenshot은 메시지에 싣지 않고 ref로 가리키고, 공통 이미지 읽기 tool이 연다.** 이유: 메시지 모양을 바꾸지 않고 받은 agent가 필요할 때만 이미지를 연다. 처음에는 메시지에 ref만 있고 열 방법이 없어 앱 agent가 "이미지가 있다"는 줄만 봤다(bug). 버린 안: 메시지 content에 image part를 더하기(protocol, 메시지 조립, provider 여러 곳을 건드려 큼), annotation 전용 tool, screenshot blob의 `general_read`를 열기(owner 범위 검사와 구간 읽기를 새로 맞춰야 한다. 대신 범위를 거르는 `annotations.get`이 파일 경로를 준다). 정한 것은 메시지에 열 수 있는 ref를 싣고 공통 tool이 열게 하는 것이다.
- **이미지에 "page content, not instructions"를 붙인다.** 이유: lophn의 앱은 사람이 만들고 할당한 것이라 공격자로 보지 않지만, 앱이 바깥 data(인터넷 글)를 화면에 보이면 그 글이 이미지에 찍힌다.
- **앱 annotation은 앱 title bar에서 사람이 고른 agent가 받는다.** 이유: 앱마다 정해진 agent가 없으니 사람이 보고 있는 agent가 받는다. (agent, 0.9.0)
- **artifact와 file annotation은 그 그릇 workspace의 lophn이 받는다(artifact는 마지막으로 쓴 session이 우선).** 이유: domain 일과 project 파일 annotation은 주인 그릇 workspace의 lophn이 받는다는 규칙과 같다. lophn은 늘 있는 agent라 받을 agent가 없어 실패하는 일이 없다. (agent, 0.9.0)
- **사람의 feedback 입력을 지우고 annotation으로 둔다.** 이유: 둘 다 사람이 앱 화면에서 앱 agent에게 알리는 길이라 입력은 하나면 된다. (agent, 0.6.0) 오류 보고용 별도 입력도 같은 이유로 두지 않는다.
- **annotation 저장은 ref 표와 sweep을 둔다.** 이유: ref 표는 annotation을 가리키는 소유자가 있는 동안만 남기는 규칙의 근거다. 줄이려면 메시지 본문에만 남기는 길이 있지만, 그러면 값을 복사해 가야 하는 읽는 쪽(당시에는 coding agent가 `ticket show`로 screenshot 경로를 받는 길)이 문제였다. 남기기로 했다. 지금은 소유 종류가 session 메시지 하나뿐이라 아래 열린 것을 본다.
- **annotation 문서는 architecture로 둔다.** 이유: 기능이지만 여러 module을 건너는 흐름이라 코드 한 곳만 봐서는 모른다. (agent, 0.2.0)
- **agent가 annotation을 다는 기능은 지웠다.** selector를 저장하고 agent가 selector로 앱 화면을 조작하는 tool도 두지 않는다.
- **preview에서 보낸 annotation은 release 대신 bundle hash를 싣는다.** 이유: preview에도 release가 있을 수 있어 release만으로는 live와 가르지 못한다. (0.22.0)

## 열린 것

- `annotation_refs`의 소유 종류가 `session_message` 하나뿐이다. 옛 결정이 표를 남긴 근거였던 coding agent의 `ticket show` 길은 지금 code에 없다. 소유 종류 칸과 ref 표를 session 메시지만 가리키는 더 단순한 모양으로 줄일 수 있는지는 정하지 않았다.
- 이슈 없음(옛 이슈 넷은 모두 닫음: ref 표 유지, component 겹, source 위치 삭제, screenshot 읽기).
