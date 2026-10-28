# artifact

agent가 쓴 정적 HTML 결과(artifact)를 사람이 탭으로 보는 메커니즘이다. artifact는 domain의 lophn data 자리 `<data>/domains/<dom>/artifacts/<name>/`에 있는 폴더 하나이고 입구는 `index.html`이다. domain은 `architecture/domain.md`다. 전용 tool은 없다. agent는 file tool로 쓰고, program이 관례 자리에서 찾아 목록과 prompt에 싣고, renderer가 대화 글의 path를 link로 그리고, shell main이 봉한 view로 그린다. AI가 쓴 page라 폴더 밖 읽기와 바깥 network를 막는다. 사람의 폴더에 있는 아무 `.html`과 project workflow의 artifact도 같은 view로 연다(`architecture/workflow.md`). 여러 곳에 걸친다. 값(`packages/protocol/domains/artifact.ts`, `values.ts`의 `artifactNameSchema`, 자리 `paths.ts`), core(file 범위 `agent-places/place/place-folders.ts`, prompt 목록 `place/artifact-list.ts`·`place-info.ts`, 내장 skill `agent-places/skills/guide-artifact/SKILL.md`, annotation 받는 쪽 `lophn-agent/session/rewind/artifact-writer.ts`와 `main/daemon/wiring/router.ts`의 `deliverArtifact`), shell main(`packages/shell/main/artifact/`, `desktop/wiring/artifact.ts`), 계약(`packages/shell/ipc/artifact.ts`, `preload/artifact-api.ts`, `preload/artifact.ts`), renderer(`renderer/artifact/`, `workspace/kinds/artifact.tsx`, `workspace/sidebar/artifact-panel.tsx`, `conversation/message-list/artifact-text.tsx`)다.

## 흐름

```
 agent (그 domain을 받은 project·앱 place의 session)
   place 정보의 Artifacts 줄 ── domain마다 Folder: <data>/domains/<dom>/artifacts (절대 path) + 목록(name, title, description)
   file.write <Folder>/<name>/index.html, data/*.json ── rewind 기록(root = artifacts 폴더 realpath, path = <name>/…)
   대화에 그 path를 말한다

 renderer
   대화 글 ── artifactMentions(text, 목록의 {domain, name}) ─▶ path 조각이 link ─▶ openArtifact(domain, name)
   sidebar Artifacts 탭 ── lophnArtifact.list(domain) ─▶ 줄을 누르면 openArtifact
   파일 열기(openFile)의 .html ─▶ openArtifactFile(path)        [Edit source] ─▶ openFile(file, {source: true})
   artifact 탭(kinds/artifact.tsx, keep) ─ toolbar + view 자리(useViewBounds) ─ lophnArtifact.open({source})
     open-link event ─▶ browser 탭      annotate ─▶ AnnotationPanel ─▶ annotations.send(target artifact)
   ▼
 shell main
   artifact-ipc.ts ── desktop 창 본문만, schema 검사
   registry.ts open ── resolveSource(artifact 폴더 또는 .html이 든 폴더의 realpath)
     ├─ 첫 view: sealArtifactSession(persist:lophn-artifact)
     │    permission 거절 → download 취소 → 죽은 proxy(loopback 포함) → 잠깐 띄운 loopback server에 닿으면 실패(unavailable) → scheme handler
     ├─ roots.register(root) ─▶ host "a-<sha256 24자>"   (root마다 origin이 다르다)
     ├─ WebContentsView(partition, preload-artifact: annotate layer만) ─▶ lophn-artifact://<host>/<entry>
     ├─ watchFolder(artifact는 recursive, .html은 그 폴더만) ─ 150ms 뒤 reloadIgnoringCache
     └─ navigation(navigation.ts): main frame은 같은 host만, http/https는 막고 입력 5000ms 안이면 open-link
   serve.ts (lophn-artifact:// handler) ── host → root ── GET·HEAD
     data/_entries.json ─▶ entries.ts가 만든 가상 목록
     그 밖 ─▶ resolveInsideRoot(어휘 + realpath가 root 안) ─▶ O_NOFOLLOW, 일반 file, 4 MiB 이하 ─▶ CSP를 단 응답
   wiring/appearance.ts ── lophn-artifact: 문서에 token 전체 + appearance CSS
   annotate.ts ── target은 view의 source: {kind: "artifact", domain, name} | {kind: "file", project}

 core
   annotations.send(target artifact) ─▶ 저장 ─▶ deliverArtifact
     (a) rewind 기록에서 그 domain 그릇 place의 열린 session 가운데 그 폴더에 마지막으로 쓴 것
     (b) 없으면 입력 session(그 그릇 place의 열린 lophn session이어야 한다) 또는 그 그릇 place의 lophn 새 session
   annotations.send(target file: 사람의 .html) ─▶ deliverFile: 그 project place의 lophn
   annotations.get ── 자격 조건 project로 그 project가 그릇인 domain의 artifact annotation만 ─▶ image.read "annotation:<id>"
```

## 지키는 것

- **자리는 `<data>/domains/<dom>/artifacts/<name>/`이고 `<name>`은 slug다.** 신원은 `{domain, name}`이다. 입구 `index.html`이 일반 file이면 artifact다. symlink 폴더와 symlink 입구는 세지 않는다. 이름 규칙은 protocol의 `artifactNameSchema`(= `slugSchema`)이고 shell은 `ipc/artifact.ts`에 사본을 둔다(shell main은 zod를 싣는 protocol file을 import하지 못한다).
- **쓰는 것은 그 domain을 맡은 agent뿐이다.** `placeScope`가 project·앱 place의 session에게 받은 domain의 폴더 전체를 read·write로 주고, home의 session에게는 주지 않는다. 사람의 폴더(project 폴더, 앱 source)가 목록 앞에 남는다. 상대 path의 기준이 첫 폴더라서 agent는 artifact를 절대 path로 쓴다(내장 skill `guide-artifact`).
- **domain 폴더와 그 안의 `skills/`, `artifacts/`는 turn을 시작할 때 place 정보를 만들면서 core가 만든다.** file tool은 없는 허용 폴더를 건너뛰므로 첫 artifact를 쓰려면 폴더가 있어야 한다. 만들지 못하면 그 turn은 그 domain 폴더 없이 간다.
- **목록은 program이 관례 자리에서 결정적으로 만든다.** 제목과 설명은 `index.html` 앞 64 KiB의 `<title>`·`<meta name="description">`에서 읽고 120자·300자로 자른다. shell main(`artifact/list.ts`)과 core(`place/artifact-list.ts`)가 같은 규칙의 사본을 갖는다. core는 shell을 import하지 못한다. prompt에는 domain 이름순, 이름 순으로 전체 50개까지 싣는다.
- **봉한 scheme은 root 안의 일반 file만 준다.** `..` 마디, 역슬래시, NUL, 풀 수 없는 percent-encoding은 거절하고, 어휘 검사 뒤 realpath도 `root + sep` 안이어야 한다(접두사만 같은 형제 폴더는 밖이다). 그 path를 `O_NOFOLLOW`로 열어 일반 file이고 4 MiB 이하일 때만 준다. 그 밖은 모두 404다.
- **root마다 host가 다르다.** host는 root realpath의 sha256 앞 24자다. 같은 root는 늘 같은 host라 localStorage가 이어지고, 다른 artifact는 다른 origin이다. workflow의 instance view는 root에 scope(instance id)를 더해(`root\0scope`) instance마다 host가 다르다. `data/_instance.json`이 어느 instance인지는 page가 아니라 등록 때 main이 정한 scope로만 정해진다.
- **응답 CSP는 `connect-src 'self'`다.** template이 자기 `data/`를 fetch해야 갈아끼우기와 series가 된다. 밖으로는 죽은 proxy(`http://255.255.255.255:9`)가 막는다. Chromium은 loopback을 proxy에서 빼므로 `<-loopback>`으로 loopback도 proxy를 거치게 한다. 봉할 때 main이 127.0.0.1에 잠깐 띄운 server를 그 session으로 쳐서 닿으면 proxy가 안 먹은 것이라 그 session을 쓰지 않는다(`unavailable`, 다음 요청이 다시 시도한다). 아무도 없는 주소를 치는 probe는 proxy와 상관없이 실패해 아무것도 확인하지 못한다.
- **`data/_entries.json`은 view가 만드는 가상 file이다.** `data/` 바로 아래 일반 file만 `{name, size, modified}`로 이름 순에 싣는다. `lstat`로 하위 폴더와 symlink를 건너뛰어 밖으로 가는 symlink의 이름과 크기가 새지 않는다. 디스크에 같은 이름이 있어도 가상이 이긴다.
- **workflow artifact.** source는 `{kind: "workflow", project, workflow, view: "static" | "instance", instance?}`이고 `instance`는 view가 instance일 때만, 그때는 꼭 있다. root는 `<data>/projects/<prj>/workflows/<name>/artifacts/<view>/`이고 realpath가 그 project의 `workflows/` 안이어야 한다(AI가 쓴 symlink가 밖이나 다른 project를 가리키면 닫는다). 쓰는 것은 그 project의 PM뿐이다(`placeScope`). 폴더 전체를 지켜본다. annotation target은 사람의 `.html`과 같은 `file`(`{project}`)이라 그 project의 PM이 받는다. 탭은 layout에 `{project, workflow, view, instance?}`로 남는다.
- **가상 file이 둘 더 있다.** 모든 view(domain artifact, 사람의 `.html`, workflow artifact)에 `_lophn/kit.js`와 `_lophn/kit.css`가 있다. renderer build의 `artifact-kit/entry.js`·`entry.css`이고 없으면 404다(`architecture/ui-kit.md` "artifact에 닿는 길"). workflow의 instance view(scope가 있는 host)에는 `data/_instance.json`이 있다. `ReadWorkflowInstance`를 cursor 끝까지 읽은 `{instance, last_reports, lines}`이고, 못 읽거나 4 MiB를 넘으면 503 `{"error": "unavailable"}`이다. scope가 없으면 디스크 file로 넘어간다. 모두 디스크의 같은 이름을 이기고 CSP는 그대로다(`script-src 'self'`).
- **instance가 바뀌면 그 instance를 여는 view만 다시 load한다.** shell main이 `WorkflowInstanceChanged`를 구독해 `views.reloadInstance(instance)`를 부른다. page 안 상태(펼친 칸, scroll)는 남지 않는다.
- **navigation은 `will-frame-navigate`와 `will-redirect`에서 정한다.** Electron 44에서 main frame은 `will-frame-navigate`가 먼저 오고, 거기서 막으면 `will-navigate`는 오지 않는다. 알리는 일을 `will-navigate`에 두면 link가 아무 일도 하지 않는다.
- **main frame은 같은 host의 `lophn-artifact:`로만 간다.** 같은 폴더 안의 다른 HTML로 가는 상대 link는 된다. http·https는 막고, 사용자 입력 5000ms 안이면 renderer에 알려 browser 탭으로 연다. `window.open`은 늘 거절한다. permission은 거절하고 download는 취소한다. subframe도 같은 host만이다.
- **preload에는 annotate layer만 있다.** tool을 부르는 bridge는 없다. 이것이 앱 화면과 갈리는 곳이다.
- **annotation의 신원은 shell main이 view의 source로 정한다.** page가 보낸 값은 쓰지 않는다. artifact annotation에는 release와 screen이 없다(null). 사람의 `.html`이면 target이 `file`(`{project}`)이다.
- **annotation을 받는 쪽은 그 폴더에 마지막으로 쓴 session이다.** rewind 기록(`rewind_files`의 root가 그 domain의 artifacts 폴더의 realpath, path가 `<name>/`로 시작, 되돌려지지 않은 쓰기)에서 그 domain 그릇 place의 열린 session 가운데 마지막 것을 고른다. root가 domain마다 달라 같은 이름의 artifact가 다른 domain에 있어도 섞이지 않는다. 없으면 pane에 열린 그 그릇 place의 lophn session이고, 그 session이 그 그릇 place의 열린 lophn session이 아니면 conflict로 거절한다. pane에 그런 session이 없으면 그 그릇 place의 lophn 새 session이다. 사람의 `.html`은 늘 그 project place의 lophn이 받는다.
- **artifact annotation을 읽는 것은 그 domain 그릇의 agent다.** 자격 조건 `project`(project place의 session)는 그 project가 그릇인 domain의 artifact target과 사람의 `.html`(file) target을, 조건 `app`(앱 place의 session)은 그 앱이 그릇인 domain의 artifact target을 읽는다. 다른 그릇 것은 not_found이고, 그릇 조건이 없는 home의 session은 forbidden이다(`architecture/annotation.md`).
- **파일이 바뀌면 열린 탭이 다시 load한다.** artifact는 폴더 전체, 사람의 `.html`은 그 폴더 바로 아래만 지켜본다(사람의 폴더는 클 수 있다). 150ms 동안 모아 한 번 다시 load한다.
- **같은 창에서 같은 source는 view 하나다.** 탭이 다시 mount되어도 view를 새로 만들지 않는다. 폴더가 없으면 view를 만들지 않고 탭이 안내와 [Try again]을 그린다.

## 왜 이 모양인가

- **artifact 전용 tool이 없다.** 만들기는 `file.write`, 찾기는 관례 자리, 알리기는 agent의 말과 renderer link, annotation 받는 쪽은 rewind 기록으로 된다. tool이 하려던 일이 이미 있는 장치로 다 된다.
- **제목과 설명을 HTML에서 읽는다.** metadata 파일을 따로 두면 둘이 어긋난다.
- **봉한 view는 browser 탭과 다른 kind다.** browser 탭의 navigation 규칙과 로그인 cookie partition을 섞지 않는다.
- **network와 외부 library가 없다.** 사람의 data가 담긴 page가 바깥 server를 부르지 않게 한다. kit은 바깥 library가 아니라 repo가 판을 잠근 lophn build를 같은 origin의 가상 path로 주는 것이다(`architecture/ui-kit.md`).
- **protocol의 `artifact.ts`는 import가 없다.** shell main은 node로 test하고 `noUncheckedIndexedAccess`로 type check해서 zod와 base를 싣는 file을 import하지 못한다. 이름 schema는 `values.ts`에 둔다.
- **화면에서 artifact를 지우는 단추는 없다.** 지운 폴더는 rewind로 되살릴 수 없어 확인과 data 손실 test가 필요하다(roadmap `artifact.md`). 지금은 agent에게 시키거나 파일 관리자로 지운다.
