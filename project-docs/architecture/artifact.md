# artifact

agent가 쓴 정적 HTML 결과(artifact)를 사람이 탭으로 보는 메커니즘이다. artifact는 그릇(project, 앱)의 lophn data 자리 `<그릇 자리>/artifacts/<name>/`에 있는 폴더 하나이고 입구는 `index.html`이다. 그릇 자리는 `<data>/projects/<prj>/`, `<data>/apps/<app>/`다. 전용 tool은 없다. agent는 file tool로 쓰고, program이 관례 자리에서 찾아 목록과 prompt에 싣고, 대화 글의 path는 link가 되고, 사람이 누르면 봉한 `<webview>` guest가 그린다. AI가 쓴 page라 폴더 밖 읽기와 바깥 network를 막는다. 사람의 폴더에 있는 아무 `.html`과 project workflow의 artifact도 같은 guest로 연다(`architecture/workflow.md`).

## 문제

agent의 결과가 사람에게 가는 길이 대화 글, 파일, 앱 화면뿐이면 표, chart, 보고서 같은 결과를 사람이 눈으로 훑기 어렵다. 그렇다고 agent가 쓴 HTML을 그냥 열면 그 page가 사람의 파일을 읽거나 바깥 server에 data를 보낼 수 있다. 이 메커니즘이 없으면 사람은 글로 된 결과만 받거나, 믿을 수 없는 page를 보호 없이 열어야 한다. 사람이 화면의 어느 곳을 가리켜 고치라고 말할 길도 앱 화면에만 있었다.

## 목표와 비목표

- 목표: agent가 HTML 폴더 하나를 쓰면 사람이 탭으로 본다. 파일이 바뀌면 그 탭이 따라 바뀐다. 사람이 그 page 위에서 annotation을 달아 그 폴더를 쓴 agent에게 보낼 수 있다.
- 목표: AI가 쓴 page가 자기 폴더 밖 file과 바깥 network에 닿지 못한다.
- 비목표: artifact 전용 tool. 만들기는 file tool, 찾기는 관례 자리, 알리기는 agent의 말로 이미 된다.
- 비목표: tool을 부르는 화면. 그것은 앱의 일이다(`architecture/app-call.md`).
- 비목표: 바깥 library와 CDN. 사람의 data가 담긴 page가 바깥 server를 부르지 않게 한다.
- 비목표: 대화 안에 artifact를 live로 끼워 그리기, 공유·내보내기·판 기록. 지금은 link로 탭을 연다.
- 비목표: 화면에서 artifact를 지우는 단추(아래 "결정").

## 모델

- **artifact.** 그릇 자리의 `artifacts/<name>/` 폴더이고 `<name>`은 slug다. 입구 `index.html`이 일반 file이면 artifact다. 신원은 `{project, name}`이나 `{app, name}`이다.
- **source.** 탭이 여는 대상 하나다. 넷 가운데 하나다.
  - `{kind: "artifact", project | app, name}`
  - `{kind: "file", project, path}`: 사람의 폴더에 있는 절대 path의 `.html`·`.htm`. root는 그 file이 든 폴더다.
  - `{kind: "workflow", project, workflow, view: "static" | "instance", instance?}`: `instance`는 view가 instance일 때만, 그때는 꼭 있다. root는 `<data>/projects/<prj>/workflows/<name>/artifacts/<view>/`다.
- **view.** 한 창에서 source 하나를 그리는 봉한 `<webview>` guest 하나다. `view_session` id로 부르고 state는 `{view_session, source, file, src, title, loading, health}`다. `health`는 `ok`, `unresponsive`, `crashed`다.
- **봉한 session.** partition `persist:lophn-artifact`와 scheme `lophn-artifact://`다. 이 partition은 permission 거절, download 취소, 죽은 proxy로 바깥 network 차단, 자기 scheme만 처리하는 handler로 이루어진다.
- **origin.** `lophn-artifact://a-<sha256 앞 24자>/<입구>?mount=<n>`이다. host는 root(workflow instance view는 root에 instance id를 더한 값)의 sha256이라 root마다 origin이 다르다. `mount`는 새 화면 세대 번호다.
- **탭.** 탭 kind는 `artifact`다. 탭 key는 `artifact:project:<id>:<name>`, `artifact:app:<id>:<name>`, `artifact-file:<path>`, `artifact-workflow:<project>:<workflow>:<view>[:<instance>]`다. layout에는 source만 남고 탭 이름은 page의 `<title>`을 따른다.

```
 agent (그 그릇 workspace의 session)
   workspace 정보의 Artifacts 줄: Folder(<그릇 자리>/artifacts 절대 path) + 목록(name, title, description)
   file.write <Folder>/<name>/index.html, data/*.json   ─ rewind 기록(root = artifacts 폴더 realpath, path = <name>/…)
   대화에 그 path를 말한다

 renderer
   대화 글의 path 조각 ─▶ link ─▶ artifact 탭      sidebar Artifacts(project) ─▶ 줄을 누르면 탭
   사람이 .html을 열면 artifact 탭, [Edit source]는 text 편집기
   탭 ─ shell:artifact-open ─▶ 창의 `<webview>` 그릇(element src = state.src)
   page의 http/https link(입력 직후) ─ open-link event ─▶ browser 탭
   Annotate ─▶ annotations.send(target)

 shell main
   open ─ source 해석(root, 입구) ─ 첫 view에서 봉한 session을 세운다
        ─ root를 host로 등록, state.src를 만든다
        ─ 그 src 하나에 한해 guest 붙이기를 받고 partition·preload를 main이 강제
        ─ 폴더를 지켜본다(150ms 모아 cache 없이 reload)
   lophn-artifact:// 요청 ─ host → root ─ GET·HEAD
        ├─ data/_entries.json, _lophn/kit.js·kit.css, data/_instance.json은 가상 file
        └─ 그 밖은 root 안의 일반 file만, CSP를 단 응답

 core
   annotations.send(target artifact) ─ 저장 ─ 받는 쪽: 그 폴더에 마지막으로 쓴 session, 없으면 lophn
   annotations.send(target file) ─ 그 project workspace의 lophn
```

## 지키는 것

1. **자리는 `<그릇 자리>/artifacts/<name>/`이고 `<name>`은 slug다.** 이름은 소문자로 시작하는 slug(63자 이하)다. 입구 `index.html`이 일반 file이어야 artifact다. symlink 폴더와 symlink 입구는 세지 않는다. 이름 규칙의 사본이 shell main 쪽에도 있다.
2. **쓰는 것은 그 그릇 workspace의 session뿐이다.** project·앱 workspace의 session은 자기 그릇의 `artifacts/`를 read·write 허용 폴더로 받고, home의 session은 받지 않는다. 사람의 폴더(project 폴더, 앱 source)는 허용 폴더 목록의 앞에 남는다. 상대 path의 기준이 첫 폴더라서 agent는 artifact를 절대 path로 쓴다(내장 skill `write-artifact`). 상대 `artifacts/…`는 사람의 폴더에 써진다.
3. **`artifacts/`는 turn을 시작할 때 workspace 정보를 만들면서 core가 만든다.** file tool은 없는 허용 폴더를 건너뛰므로 첫 artifact를 쓰려면 폴더가 있어야 한다. 폴더를 만들지 못하면 그 turn은 그 폴더 없이 간다.
4. **목록은 program이 관례 자리에서 결정적으로 만든다.** `artifacts/` 바로 아래 slug 폴더 가운데 입구가 일반 file인 것이다. 제목과 설명은 `index.html` 앞 64 KiB의 `<title>`과 `<meta name="description">`에서 읽고 120자와 300자로 자른다. 제목이 없으면 폴더 이름이다. shell main(sidebar 목록)과 core(prompt 목록)가 같은 규칙을 각자 갖는다. core는 shell을 import하지 못한다. prompt에는 이름 순으로 50개까지 싣고 넘으면 "N more" 줄을 쓴다.
5. **봉한 scheme은 root 안의 일반 file만 준다.** `..` 마디, 역슬래시, NUL, 풀 수 없는 percent-encoding은 거절한다. 어휘 검사 뒤 realpath도 root 안이어야 한다(접두사만 같은 형제 폴더는 밖이다). 그 path를 symlink를 따르지 않고 열어 일반 file이고 4 MiB 이하일 때만 준다. GET·HEAD 말고는 405이고, 그 밖의 실패는 모두 404다. 응답은 cache하지 않는다.
6. **root마다 host가 다르다.** 같은 root는 늘 같은 host라 localStorage가 이어지고 다른 artifact는 다른 origin이다. workflow의 instance view는 root에 instance id를 더해 instance마다 host가 다르다. `data/_instance.json`이 어느 instance인지는 page가 정하지 못하고 등록 때 main이 정한 값으로만 정해진다.
7. **응답 CSP는 `connect-src 'self'`다.** script와 style은 `'self'`와 inline, img와 font는 `'self'`와 data(img는 blob도), `object-src 'none'`, `form-action 'none'`이다. template이 자기 `data/`를 fetch해야 갈아끼우기와 series가 된다. 밖으로는 죽은 proxy(`http://255.255.255.255:9`)가 막는다. Chromium은 loopback을 proxy에서 빼므로 loopback도 proxy를 거치게 한다. 봉할 때 main이 127.0.0.1에 잠깐 띄운 server를 그 session으로 쳐서 닿으면 proxy가 안 먹은 것이라 그 session을 쓰지 않는다(`unavailable`이고 다음 요청이 다시 시도한다). 그 server를 못 띄우면 검증하지 못한 것이라 봉하지 못한 것으로 본다. 아무도 없는 주소를 치는 probe는 proxy와 상관없이 실패해 아무것도 확인하지 못한다.
8. **가상 file이 셋이고 모두 디스크의 같은 이름을 이긴다.** CSP는 그대로다.
   - `data/_entries.json`: 모든 view에 있다. `data/` 바로 아래 일반 file만 `{name, size, modified}`로 이름 순에 싣는다. 하위 폴더와 symlink는 건너뛰고(밖으로 가는 symlink의 이름과 크기가 새지 않게), `data/` 자체가 밖으로 가는 symlink면 빈 목록이다.
   - `_lophn/kit.js`, `_lophn/kit.css`: 모든 view에 있다. renderer build가 판을 잠가 낸 kit이고 없으면 404다(`architecture/ui-kit.md` "artifact에 닿는 길").
   - `data/_instance.json`: workflow의 instance view(scope가 있는 host)에만 있다. instance를 cursor 끝까지 읽은 `{instance, last_reports, lines}`이고, 못 읽거나 4 MiB를 넘으면 503 `{"error": "unavailable"}`이다. scope가 없으면 디스크 file로 넘어간다.
9. **workflow artifact의 root는 그 project의 `workflows/` 안이다.** realpath가 그 밖이면(AI가 쓴 symlink가 밖이나 다른 project를 가리키면) 닫는다. 쓰는 것은 그 project workspace의 session이다. 폴더 전체를 지켜본다. annotation target은 사람의 `.html`과 같은 `file`(`{project}`)이라 그 project workspace의 lophn이 받는다. 탭은 layout에 `{project, workflow, view, instance?}`로 남는다.
10. **instance가 바뀌면 그 instance를 여는 view만 다시 load한다.** shell main이 workflow instance 변경을 구독해 그 instance의 view에만 reload를 건다. page 안 상태(펼친 칸, scroll)는 남지 않는다.
11. **navigation은 main frame이 같은 host의 `lophn-artifact:`로만 간다.** 같은 폴더 안의 다른 HTML로 가는 상대 link는 된다. http·https는 막고, 사용자 입력 5000ms 안이면 renderer에 알려 browser 탭으로 연다. 입력 없이 page가 스스로 보낸 이동은 조용히 버린다. `window.open`은 늘 거절한다(http·https이고 입력 직후면 같은 방식으로 browser 탭으로 알린다). subframe은 같은 host만이다. permission은 거절하고 download는 취소한다.
12. **navigation 판단은 `will-frame-navigate`와 `will-redirect`에서 한다.** Electron 44에서 main frame은 `will-frame-navigate`가 먼저 오고, 거기서 막으면 `will-navigate`는 오지 않는다. 알리는 일을 `will-navigate`에 두면 link가 아무 일도 하지 않는다.
13. **guest 붙이기는 main이 정한 값으로만 한다.** `<webview>`는 renderer가 만들지만 붙이기는 src 하나에 한 번만 받는다. renderer가 적은 partition·preload·webPreferences는 버리고 main이 정한 값(봉한 partition, annotate layer만 있는 preload)을 쓴다. 이 창의 view가 아니거나 모르는 src거나 이미 쓴 src면 거절한다. 붙은 guest의 안쪽 `<webview>` 만들기도 거절한다. 패키지된 앱에서는 DevTools를 열자마자 닫는다.
14. **preload에는 annotate layer만 있다.** tool을 부르는 bridge도 오류 보고도 없다. 이것이 앱 화면과 갈리는 곳이다.
15. **annotation의 신원은 shell main이 view의 source로 정한다.** page가 보낸 값은 쓰지 않는다. artifact annotation에는 release와 screen이 없다(null). target은 `{kind: "artifact", project | app, name}`이고 사람의 `.html`과 workflow artifact는 `{kind: "file", project}`다.
16. **annotation을 받는 쪽은 그 폴더에 마지막으로 쓴 session이다.** rewind 기록(root가 그 그릇의 artifacts 폴더 realpath, path가 `<name>/`로 시작, 되돌려지지 않은 쓰기)에서 그 그릇 workspace의 열린 session 가운데 마지막 것을 고른다. 쓴 agent는 가리지 않는다. root가 그릇마다 달라 같은 이름의 artifact가 다른 그릇에 있어도 섞이지 않는다. 쓴 session이 없으면 pane에서 보낸 session이 받는다. 그 session은 그 그릇 workspace의 열린 lophn session이어야 하고 아니면 conflict로 거절한다. pane에 그런 session이 없으면 그 그릇 workspace의 lophn 새 session이다. 사람의 `.html`은 같은 순서에서 쓴 session 조회만 빠지고 그 project workspace의 lophn이 받는다.
17. **artifact annotation을 읽는 것은 그 그릇의 agent다.** 자격 조건 `project`(project workspace의 session)는 그 project의 artifact target과 file target을, 조건 `app`(앱 workspace의 session)은 그 앱의 artifact target을 읽는다. 다른 그릇 것은 not_found이고, 그릇 조건이 없는 home의 session은 forbidden이다(`architecture/annotation.md`).
18. **파일이 바뀌면 열린 탭이 다시 load한다.** artifact와 workflow artifact는 폴더 전체, 사람의 `.html`은 그 폴더 바로 아래만 지켜본다(사람의 폴더는 클 수 있다). 150ms 동안 모아 cache 없이 한 번 다시 load한다. view가 깨진 상태(crashed)면 하지 않는다. 폴더가 사라지거나 watch가 깨지면 조용히 멈춘다.
19. **같은 창에서 같은 source는 view 하나다.** 탭이 Float·Dock으로 다시 mount되어도 창의 `<webview>` 그릇이 element를 들고 있고 view_session도 그대로다. 같은 source를 동시에 연 요청은 먼저 만든 view로 모인다. main이 새 화면을 열 때(열기, crash 뒤 다시 열기)는 `mount`가 바뀐 새 src를 내고 renderer가 element를 새로 만든다. 건강한 view의 reload는 cache 없이 다시 load하고 깨진 view의 reload는 새 화면 세대를 연다.
20. **폴더가 없으면 view를 만들지 않는다.** open은 not_found로 답하고 탭이 안내와 다시 시도 단추를 그린다. 봉한 session을 못 세웠으면 unavailable이다.
21. **workspace를 바꾸면 artifact 탭의 page는 놓고 돌아오면 다시 load한다.** artifact page의 preload에는 bridge가 없어 "살려 둬" 신호를 보낼 길이 없다(`architecture/workspace-layout.md`의 "workspace를 떠나도 살려 두는 page"). Detach하면 page가 다시 load된다.
22. **artifact IPC는 desktop 창의 shell renderer에서 온 요청만 받는다.** 요청마다 sender가 살아 있는 desktop 창의 main frame인지, 입력이 schema에 맞는지 본다. 창은 sender에서 main이 정한다. view를 열 수 있는 것은 이 길뿐이고 page(guest)는 부르지 못한다.

## 경계와 계약

- 파일 규약: `<그릇 자리>/artifacts/<name>/index.html`, 같은 폴더의 file(상대 path로 읽음), `data/*.json`. 쓰는 법은 내장 skill `write-artifact`다.
- workspace 정보(turn 시작): `Artifacts` 절에 `Folder:` 절대 path와 `- <name>: <title> — <description> (artifacts/<name>/index.html)` 줄들(50개까지).
- shell IPC(renderer → main): `shell:artifact-open`(source), `shell:artifact-reload`(view_session), `shell:artifact-list`(`{project}`나 `{app}`). push: `shell:artifact-state`(view state), `shell:artifact-event`(`open-link`). renderer API는 `window.lophnArtifact`다. view 폐기는 앱 view와 같은 `shell:view-close`를 쓴다. 오류는 공통 code 가운데 `invalid_input`, `forbidden`, `not_found`, `unavailable`이다. 목록 줄은 `{name, title, description, modified}`다.
- 봉한 scheme: `lophn-artifact://<host>/<path>`, GET·HEAD. 가상 file `data/_entries.json`, `_lophn/kit.js`, `_lophn/kit.css`, `data/_instance.json`(instance view).
- annotation: `annotations.send`의 target `{kind: "artifact", project | app, name}` 또는 `{kind: "file", project}`. 읽기는 `annotations.get`과 `image.read "annotation:<id>"`다(`architecture/annotation.md`).
- 대화 글 link: 이 창 workspace의 `…/projects/<prj>/artifacts/<name>` 또는 `…/apps/<app>/artifacts/<name>` 꼴 path 조각이 그 workspace의 아는 artifact를 가리킬 때 link가 된다. 글 끝 구두점은 뺀다. 목록에 아직 없는 이름이 글에 나오면 목록을 이름당 한 번 다시 읽는다.
- 탭 진입: 대화 link, project sidebar Artifacts, 파일 열기의 `.html`(Home에서는 문서 탭으로 열린다. artifact 탭은 project의 파일로만 열린다), workflow 탭의 [Open artifact]다. 탭 머리 줄에는 [Edit source](입구나 `.html` 원본을 text 편집기로)와 Annotate가 있고 Annotate가 켜지면 머리 줄 전체가 Annotate 줄이 된다. card 밖(floated)에서는 ⋯ 메뉴가 없어 탭 자기 toolbar에 단추를 둔다.
- 저장 모양: layout의 artifact 탭 source(위 "탭"). 이 문서가 새로 정하는 저장 file은 없다.
- 관련 문서: `architecture/annotation.md`(target과 받는 쪽), `architecture/workflow.md`(workflow artifact), `architecture/ui-kit.md`(kit), `architecture/workspace-layout.md`(`<webview>` 그릇), `architecture/appearance.md`(lophn-artifact 문서에 token 전체와 appearance CSS를 주입한다).

## 결정

- **artifact 전용 tool을 두지 않는다.** 이유: 만들기는 file tool, 찾기는 관례 자리, 알리기는 agent의 말과 link, annotation 받는 쪽은 rewind 기록으로 이미 된다. (사람, roadmap)
- **화면에서 artifact를 지우는 단추를 두지 않는다.** 이유: 지운 폴더는 rewind로 되살릴 수 없어 확인 대화상자와 data 손실 test가 필요하다. 지금은 agent에게 시키거나 파일 관리자로 지운다(roadmap `artifact.md`). (사람, 2026-10-19)
- **agent는 artifact를 절대 path로 쓴다.** 이유: 상대 path의 기준이 사람의 project 폴더라서 상대 `artifacts/…`는 사람의 폴더에 써진다. (agent)
- **제목과 설명을 HTML에서 읽는다.** 이유: metadata 파일을 따로 두면 둘이 어긋난다.
- **봉한 guest는 browser 탭과 다른 kind다.** 이유: browser 탭의 navigation 규칙과 로그인 cookie partition을 섞지 않는다. 같은 창의 `<webview>` 그릇을 쓰지만 partition·preload·navigation 규칙은 kind별로 main이 강제한다.
- **network와 외부 library가 없다.** 이유: 사람의 data가 담긴 page가 바깥 server를 부르지 않게 한다. kit은 바깥 library가 아니라 repo가 판을 잠근 lophn build를 같은 origin의 가상 path로 주는 것이다.
- **값과 이름 규칙은 shell main이 import할 수 있는 모양으로 둔다.** 이유: shell main은 node로 test하고 `noUncheckedIndexedAccess`로 type check해서 zod와 base를 싣는 protocol file을 import하지 못한다. 그래서 artifact 공통 값(자리, 입구, 제목·설명 읽기, 글 속 path 조각 찾기)은 import 없는 file에 두고 이름 schema는 shell 쪽에 사본을 둔다. (agent)
- **화면 그릇은 `<webview>`다(앱 화면과 함께).** 이유: native view는 shell DOM 위에 그려져 floated 패널·menu·toast가 page 밑에 깔렸고 우회 장치가 쌓였다. artifact 탭도 같은 겹침 문제를 갖고 있어 같이 옮겼고, 남기면 앱 쪽 장치를 지우지 못한다. 버린 안: iframe(preload의 isolated world, partition, `sender.id` 신원을 잃는다). (artifact 탭을 옮기는 것은 agent, `<webview>` 선택은 사람)
- **붙이기 ticket은 src 하나이고 한 번만 쓴다.** 이유: renderer가 적은 partition·preload·webPreferences를 믿지 않고 registry가 정한 값만 쓴다. (agent)
- **Annotate는 탭의 머리 줄(⋯ 메뉴)에 둔다.** 이유: 화면 위를 덮는 목록과 toast는 그 밑의 요소를 가렸다. 앱 화면 탭과 같은 기능이라 같이 옮겼다. (agent)
- **navigation 판단을 `will-frame-navigate`에 둔다.** 이유: Electron 44에서 `will-navigate`는 오지 않아 link가 아무 일도 하지 않았다. artifact 탭을 손으로 확인하다 찾았다.
- **artifact는 그릇 자리에 있다(agent, 2026-11-03).** 처음에는 domain 폴더(`<data>/domains/<dom>/artifacts/`)에 있었다. domain을 지우며 data step `artifacts.container`가 옮긴다. 그릇마다 domain 이름 순으로 옮기고, 이름이 겹치면 뒤 domain의 것이 `<name>-<domain 이름>`이 된다. 그 이름도 있으면 옮기지 않는다(덮어쓰지 않는다). 같은 step이 그 artifact의 rewind 기록(옛 root `…/domains/<dom>` + `artifacts/<name>/…`와 `…/domains/<dom>/artifacts` + `<name>/…` 두 꼴)을 새 꼴(root `<그릇 자리>/artifacts`, path `<최종 이름>/…`)로 다시 써, 옛 checkpoint를 되돌려도 새 자리의 그 artifact에 쓰게 하고, workspace layout의 artifact 탭도 새 신원으로 다시 쓴다. 옮기기 전에 계획을 다 세우고 기록과 layout을 먼저 써서, 중간에 끊겨 다시 돌아도 같은 이름이 된다.
- **kit 쓰는 법은 skill `write-artifact` 한 곳에 둔다.** 이유: artifact를 쓰는 모든 agent가 받고, 같은 API 설명이 두 곳에 있으면 갈라진다. workflow에만 걸린 것(static·instance artifact, `data/_instance.json`)은 `write-workflow`에 둔다. (agent)

## 열린 것

- 화면에서 artifact 지우기(roadmap `artifact.md`). 확인 대화상자와, 지우기가 그 폴더 밖을 건드리지 않는다는 위험 test가 먼저다.
- 인터넷 page(browser 탭)의 annotation은 하지 않는다. transport와 받는 쪽이 정해진 뒤 따로 roadmap을 쓴다.
- artifact 탭의 page는 workspace를 떠나면 놓인다. page와 host 사이 통로가 없어 "살려 둬" 신호를 켤 수 없다.
- sidebar Artifacts 목록은 project에만 있다. 앱의 artifact는 대화 link로만 연다.
- sidebar 목록은 탭이 그려질 때 한 번 읽고 폴더 변경을 따라가지 않는다(다시 보일 때 읽는다).
