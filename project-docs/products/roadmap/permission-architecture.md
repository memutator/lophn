# permission-architecture: 권한 체계를 다시 세운다 (조용한 거부와 묻기 누락)

상태: 로드맵 초안. 2026-11-25 사람이 권한 체계가 미성숙하다고 했고 조사(`feature-cleanroom` workflow, harness-lab `_report/permission-architecture/`)를 바탕으로 planner가 정리했다. "(agent)"는 planner의 기술 결정이다. 제품 결정은 2026-11-25 사람이 내렸다("정한 것 › 제품"). 구현은 "구현 범위"를 따른다.
배경 문서: `project-docs/architecture/{approval,extension,agent-definition,workspace-session,settings,run,job,workflow}.md`, `project-docs/products/roadmap/approval.md`, issue `shell-run-bypasses-file-scope`(kept).

## 사람의 말 (원문)

2026-11-25:

> 지금 권한 체계가 그냥 너무 미성숙한 거 같음
> lophn agent가 조용히 denied 되는 것도 많고
> 물어봐야하는 데 안 물어보고 그런 것도 많고
> agent-loop 있는 harness 들 위주로 조사해줘

design에서 (2026-11-25):

> 권한 4단계가 무슨 말이야
> 단계 이름이 작업 폴더가 무슨 뜻인데 / 아니 그니까 왜 권한 단계의 이름이 작업 폴더냐고
> 되돌릴 수 없는 일만 묻는다 할 때, 누가 제어한다는거임? 되돌릴 수 없다는 일의 판정을 누가하는데
> 조용히 forbiden 되는 lophn 명령들은 뭐 있었는데?
> 1은 기본값 설정 할 수 있도록 하고 초기에 기본값은 3으로 두자
> 그럼 workflow에서 lophn agent라면 그걸 미리 설정할 수 있게끔 하는 게 나을려나
> 나머지는 추천대로

## 왜

2026-10-20 `approval-simplify`는 "할당이 허락, 시킨 것이 승낙"으로 옛 approval의 마찰을 걷어 냈다. 그 방향은 맞았지만 두 군데가 거꾸로 놓였다(조사 `lophn.md` 1~3절, main `8f267e3db`에서 다시 확인).

1. **막힌 것을 숨긴다.** `tools/work.ts`의 `FAILURE_SUMMARIES`가 `forbidden`을 `not_found`와 같은 문장("tool target is not available")으로 덮는다. 예외(`carriesReason`, `INPUT_SCOPED_FAILURES`)는 tab·browser·`team.spawn`·`call.send`·`skill.read`·`agent.card`·`ask.secret`뿐이다. gate 거부는 `tool call was denied (<reason>)` 꼬리표 하나이고 걸린 규칙(`pattern`)은 `tool-gate.ts`가 버린다. 거부에는 event도 화면 표시도 없다. `/permissions`는 앱 할당만 보인다.
2. **물어야 할 것을 묻지 않는다.** `shell.run`은 기본 `allow`이고 제품 기본 `ask`는 10줄뿐이다. 명령을 `&&|;|\n`으로 자르기만 해서 `sh -c "rm -rf ~"`, `env rm -rf ~`는 floor를 지난다. `always`는 앞 두 낱말 + `*`라 `rm -rf ./dist`를 한 번 허락하면 `rm -rf *`가 영구 허락이 된다. unattended turn은 `ask`를 `run`으로 바꾼다(`judge.ts` `askIn`). `<workspace>/.lophn/tools/*.ts`는 확인 없이 실행되고 MCP tool은 무조건 `run`이다.

### 지금 조용히 막히는 것 (main `8f267e3db`, 2026-11-25 planner 확인)

"없다" 문장으로 덮이는 `forbidden`:
- `file.*`·`skill check`: 등록 폴더 밖 경로("path is outside the workspace")
- `workflow` 고치기·이름 바꾸기·지우기: 앱 agent가 project workflow를, 다른 project의 workflow를, 폴더가 symlink·폴더 밖
- `artifact delete`: 다른 project·앱의 것, symlink·폴더 밖
- `agent update`·`agent delete`: lophn avatar, lophn·기본 coding agent 지우기
- `skill check`·`skill list`·`follow-up list`: 다른 workspace의 것
- `--on`: private workspace에서 다른 컴퓨터로
- `release`: 사람만 하는 되돌리기·activation 동의
- MCP 연결: 401, 다시 로그인 필요(agent가 sign-in을 청해야 하는 줄 모른다)

꼬리표만 가는 gate 거부: `shell_rule`(어느 규칙인지 없음), `not_assigned`, `removed`, `no_person`.
답 없이 끝나는 것: workspace가 허락하지 않는 operation의 자격 요청(`run-loop/agent-credentials.ts`가 `undefined`를 돌려준다).

## 다른 제품은 (조사 요지)

자체 agent loop 9종(Codex, Claude Code 공개 문서, OpenCode, Hermes, oh-my-pi, DeepSeek Harness, Mixdog, Happy Agent, pi):

- **사람이 없으면 묻는 것은 거절이다**(8/8). 무인 실행은 만들 때 미리 허락한 범위나 명시적 "다 맡기기" 옵트인으로만 연다.
- **막을 때 model과 사람 모두에게 무엇이, 왜, 어떤 규칙으로, 어떻게 풀지를 말한다.** model에는 "우회하지 말라"도 함께. 사람 쪽 거부 표시·복구는 업계도 약하다.
- **권한 단계가 3~4개다.** OS sandbox가 있는 제품은 sandbox 안 shell을 묻지 않고, 없는 제품은 shell을 기본으로 묻는다. sandbox 없이 shell 기본 허락 + 짧은 블랙리스트(OpenCode, Hermes, Mixdog, lophn)가 가장 많이 놓친다.
- **floor와 deny는 어느 단계·규칙·훅으로도 풀리지 않는다.** 저장소 파일이 사람의 권한을 넓히지 못하고 agent가 자기 권한을 고치지 못한다.
- **shell 검사는 비대칭이다.** 허락은 읽을 수 없는 명령에 주지 않고, 위험 검사는 래퍼·서브셸을 벗겨 깊게 본다. `always`는 넓은 접두사를 만들지 못한다.
- **허락은 이번 한 번 / 이 대화 동안 / 항상 / 거절(+이유).** 이유 없는 거절은 그 걸음을 멈추고 이유 있는 거절은 model에 전해 계속한다.
- **자식은 부모보다 넓어지지 않는다.**
- 갈리는 곳: 기본 자세, 바깥 폴더, OS sandbox, LLM 판정(guardian).

## 지금 lophn에 있는 기반 (다시 쓴다)

1. 순수 함수 판정기 `packages/core/approvals/gate/judge.ts`.
2. 기다리는 turn 하나의 묻는 길과 카드(`turn-requests.ts`, `approval-card.tsx`): `once | always | reject(+이유)`, desktop·폰 같은 계약. 카드에 `session` 선택지 자리가 이미 있다.
3. 사람 자격 경계: `turn_requests/decide`는 사람만, `approval: "person"` 설정과 `describe(before, after)`, `locked`, agent가 자기 할당·skip을 못 넓힘.
4. 팀 자식의 물음은 부모에게 `once`로(`to_parent`).
5. `file.write`·`file.edit`의 `realpath` 범위 검사와 rewind.
6. shell 규칙 세 층(제품, 전역, project)이 data root 설정(`approvals.shell_rules`)에 있고 사람의 폴더에 두지 않는다.

## 표준을 그대로 가져올 수 없는 곳

1. **판정 대상이 넓다.** Read/Edit/Bash 넷이 아니라 `file.*`, `shell.run`, `web.*`, 앱 command, MCP, `local__*`, `setting`, `project_command`, `lophn` CLI다. 한 판정 엔진이 모두 받는다.
2. **"앞에서 한 번 허락 + rewind로 복구"가 lophn의 철학이다.** 그래서 파일 쓰기마다 묻지 않는다. lophn이 되돌리기 기록을 남기는 것(등록 폴더 안 `file.*` 쓰기)은 그대로 두고, 남기지 못하는 것을 묻는다.
3. **권한 규칙은 저장소에 두지 않는다.** 규칙·신뢰 목록은 data root(core 소유)에만 둔다. "저장소 설정이 전역 권한을 넓힌다"는 구멍이 처음부터 없다.
4. **팀 자식 → 부모, 폰, 다른 컴퓨터가 같은 묻는 길을 쓴다.** 새 선택지와 거부 event는 모든 표면에 맞고, 기존 불변식(자식은 `once`만, 사람 자격만 결정)은 지킨다.
5. **OS sandbox가 없다.** 앱 계층(shell 기본 묻기, 구조화 검사, 민감 경로)이 그만큼 단단해야 한다.
6. **사람의 예전 결정과 부딪힌다.** "할당이 허락"(사람, 2026-10-20), "할당한 tool의 external도 묻지 않음"(사람, 2026-10-21), "이 session 동안 허락은 버림"(사람, 2026-10-20), "unattended는 묻지 않음"(`approval-simplify`). 제품 결정 1·3·6이 이것들을 다시 열었다.

## 정한 것

### 기술 (agent)

1. **판정은 program이 표로 한다.** model이 "되돌릴 수 있겠다"고 판단하지 않고 LLM 심사관도 두지 않는다. 같은 호출은 늘 같은 판정이다. "묻지 않아도 되는 것"의 기준은 "lophn이 되돌리기 기록을 남기는가"이고 도구 범주마다 고정이다: 등록 폴더 안 `file.*` 쓰기는 남긴다, shell은 무엇을 바꿀지 모르므로 남기지 못하는 쪽(내장 읽기 명령 목록만 예외), 폴더 밖 쓰기는 남기지 못한다. 앱·MCP·로컬 tool은 이 기준이 아니라 할당·신뢰로 판정한다. 그 위에 사람의 규칙이 이기고 agent는 규칙을 만들지 못한다. (agent: 사람의 물음 "판정을 누가 하는데"에 답한 것. 기존 원칙 "판정은 program이 결정적으로 한다", `approval.md`)
2. **거부를 숨기지 않는다.** 권한·범위·모드·정책 거부는 `PermissionDenial{tool, category, target_summary, reason_kind, rule_pattern, message, recovery_hint, recovery_action}`(spec 6.1)로 model에 간다. 모든 거부 문장 끝에 "다른 tool(shell.run 등)로 우회하지 말고 사람에게 설명하거나 안내된 길을 쓰라"를 붙인다. handler의 `forbidden` 문장은 그대로 싣는다(core handler가 쓰는 고정 문장이다). 존재를 감춰야 하는 대상(다른 session의 탭, private workspace의 것)은 handler가 `not_found`로 돌려주고, `not_found`는 지금처럼 공통 문장이다. (agent: AGENTS.md는 사람의 글과 앱을 공격자로 보지 않는다. 본인 컴퓨터에서 model의 눈을 가리면 헛돌고 우회한다. 존재 숨김은 code로 가르는 것이 tool별 예외 목록보다 단순하다)
3. **거부는 사람에게도 보인다.** core가 `PermissionDenied` event를 내고 session 기록에 남긴다. 대화 타임라인은 일반 실패와 다른 "막힘" 표시 + 한 줄 이유 + 걸린 규칙을 보인다. `/permissions`는 지금 단계, 읽기·쓰기 폴더(이번 대화에 연 바깥 폴더 포함), 규칙 요약(floor 수, 전역, project, 이번 대화 허락과 개별 해제), 할당 앱·MCP(신뢰)·신뢰한 로컬 tool, 최근 거부를 한 화면에 보인다. (agent: spec 6.3·6.4)
4. **거부 복구 버튼.** floor와 `locked`는 이유만 보이고 버튼이 없다. 사람이 건 deny 규칙은 "규칙 고치기"(Settings로 이동)만 준다. 미할당 앱은 "할당하기", 단계 제약은 "단계 바꾸기", 신뢰 전 로컬 tool은 "신뢰하기", 사람 없는 실행에서 막힌 shell은 "항상 허락 규칙 더하기"를 준다. 버튼은 상태만 바꾸고 다시 하는 것은 사람의 다음 메시지다. (agent: deny 규칙의 엄격함을 깨지 않으면서 복구 마찰을 없앤다)
5. **판정 엔진 하나.** shell 규칙과 `call.kind`별 분기를 `evaluatePermission(request, layers, sessionGrants, mode, context)` 순수 함수 하나로 합친다(spec 3.2): floor → 사람 규칙(전역·project, `deny > ask > allow` 고정) → 이번 대화 허락 → 단계 기본값 → 실행 맥락(attended·unattended·팀 자식). 여러 조각은 가장 나쁜 판정으로 합친다. 규칙 데이터는 `PermissionRule{id, category, pattern, action, reason?, source}`(spec 3.1)이고 data root 설정에만 있다. 지금 `approvals.shell_rules`는 같은 설정 안에서 `category: "shell"` 규칙으로 옮긴다(사람의 규칙은 그대로 옮기고 지우지 않는다). (agent: `findLast`는 `deny`에 실수로 구멍이 날 수 있다. 고정 우선이 추론이 쉽다)
6. **shell 검사기를 상태 기계로.** 정규식 자르기를 TypeScript 순수 구현 스캐너로 바꾼다(native tree-sitter 없음, spec 4.1~4.5): 따옴표·이스케이프·heredoc·연산자·서브셸·명령 치환·리다이렉션·선행 env, 래퍼 깊이 8까지 벗기기, `rm` flag와 `~`·`$HOME`·실제 home 정규화, 입력 상한. 허락은 읽을 수 없는 명령(`opaque`)에 주지 않고 `sudo`류는 최소 `ask`(한 번만). 내장 읽기 명령 목록은 spec 4.5. (agent: 예전 "명령 parser를 쓰지 않는다" 결정을 뒤집는다. `sh -c "rm -rf ~"`가 floor를 지나는 것은 데이터 손실 버그다)
7. **`always` 패턴을 안전하게.** 금지 접두사(spec 4.6)와 CLI subcommand 길이 표로 최소 접두사를 만들고, 위험·`opaque`·여러 줄 명령은 `always`를 주지 않는다. 카드는 저장될 패턴 그대로를 보인다. 이미 저장된 사람의 규칙 가운데 금지 접두사에 걸리는 것(예: `rm -rf *`)은 지우지 않고 Settings에서 경고 표시를 단다. (agent: 사람의 데이터를 지우지 않는다)
8. **이유 없는 거절과 이유 있는 거절을 나눈다.** 이유 없으면 그 응답의 남은 쓰기·바깥 호출과 그 걸음을 멈추고, 이유 있으면 그 이유를 model에 주고 계속한다. 읽기와 무관한 호출은 막지 않는다. (agent: spec 5.1)
9. **자식은 부모보다 넓어지지 않는다.** 팀 자식의 단계는 `min(부모, 정의 기본값)`이다. 자식의 물음은 지금처럼 부모에게 `once`만이고, 사람 전용 등급(`approval: "person"` 설정, project command 정의 쓰기, 로컬 tool 신뢰)은 부모가 대신 못 한다(`deny no_person`). (agent: 기존 원칙 + 단계 상속)
10. **민감·자기 보호 경로.** `<data root>` 안 설정·권한·agent 정의·secret 파일은 `file.*`로 쓰지 못한다(전용 route만). workspace 안 `.git/hooks/*`, `.git/config`, `.lophn/tools/*` 쓰기는 모든 단계에서 묻는다. `.env*` 읽기는 묻는다(`.env.example`, `.env.sample` 제외). (agent: spec 2)
11. **단계는 사람만 바꾼다.** session의 단계는 대화 화면에서 사람이 바꾸고(지금 skip 토글 자리), agent 정의의 기본 단계(지금 `skip` 칸을 대신하는 `permission_mode`)도 사람만 쓴다. 폰·다른 기기는 단계를 낮출 수만 있고 "다 맡기기"로 올리지 못한다. fork는 단계를 가져가지 않고 정의의 기본값으로 시작한다. 낮추면 다음 tool 호출부터 적용한다. 옛 `skip: true`는 "다 맡기기"로 옮긴다. (agent: 지금 skip의 계약을 그대로 옮긴다)
12. **unattended와 단계는 따로 본다.** 단계는 session의 것이고, 사람이 있느냐는 turn의 실행 맥락이다. unattended turn에서 판정이 `ask`면 제품 결정 3을 따른다. "다 맡기기" 단계는 `ask`를 허락으로 바꾸므로 unattended에서도 돈다. 사람이 그 agent의 기본 단계를 "다 맡기기"로 둔 것이 무인 옵트인이다(floor, deny, 사람 전용 등급은 그래도 막는다). (agent: 업계의 명시적 옵트인 `--yolo`와 같은 꼴)
13. **OS sandbox는 이번에 넣지 않는다.** 판정 엔진에 격리 슬롯(`IsolationBackend = "none"`)만 둔다. 한 번 허락한 `bash build.sh`가 안에서 하는 일은 막지 못한다. (agent: 세 OS native 유지 비용이 크고 지금 고통은 권한 체계 자체다)
14. **LLM 판정(guardian)은 두지 않는다.** (기존 원칙)

### 제품 (사람)

1. **단계는 넷이고 기본 단계는 사람이 설정한다. 처음 기본값은 ③이다.** (사람, 2026-11-25: "1은 기본값 설정 할 수 있도록 하고 초기에 기본값은 3으로 두자")
   - ① 보기만: 읽기·검색만. ② 다 묻기: 읽기만 묻지 않음. ③ 고치기는 알아서: 등록 폴더 안 파일 수정과 내장 읽기 명령은 묻지 않고, 그 밖의 shell·폴더 밖·바깥은 묻는다. ④ 다 맡기기: floor·deny·사람 전용 등급 밖은 묻지 않는다.
   - ③에서 읽기 명령이 아닌 shell은 처음 한 번 묻고 "이 대화 동안 허락"과 "항상 허락"으로 점점 덜 묻는다. "이 대화 동안"은 2026-10-20에 버린 것을 되살린다.
   - 기본값은 Settings에서 사람이 고른다(전역 하나). agent 정의의 기본 단계가 있으면 그것이 이긴다. 대화마다 사람이 바꾼다.
2. **화면 이름은 ① 보기만 ② 다 묻기 ③ 고치기는 알아서 ④ 다 맡기기.** "작업 폴더"는 맡기는 정도를 말하지 못한다(사람 지적). (사람, 2026-11-25: "나머지는 추천대로")
3. **사람이 없는 실행(job, workflow non-human step, CLI run)에서 `ask`가 나오면 거절하고 막힌 이유를 남긴다.** 미리 둔 허락 규칙과 그 실행의 단계가 ④인 것만 통과한다. 폰으로 묻고 멈춰 두기는 이번에 하지 않는다. (사람, 2026-11-25)
4. **workflow는 participant마다 단계를 미리 정할 수 있다. 정하는 것은 사람이다.** (사람, 2026-11-25: "workflow에서 lophn agent라면 그걸 미리 설정할 수 있게끔 하는 게 나을려나" — 방식은 아래 기술 15)
5. **등록 폴더 밖 파일은 묻고, 허락하면 한 번 또는 이 대화 동안 그 폴더를 연다.** 민감 경로(`~/.ssh`, `~/.aws`, lophn data root 설정)는 계속 막는다. (사람, 2026-11-25)
6. **할당한 내 앱은 묻지 않는다(사람이 command별로 "묻기"를 켤 수 있다). 바깥 MCP 서버는 읽기 아닌 tool을 묻고 사람이 "신뢰"로 표시한 서버는 묻지 않는다. `.lophn/tools` 스크립트는 처음과 내용이 바뀌었을 때 한 번 묻는다.** (사람, 2026-11-25)

### 기술 (agent, 사람 결정에 따라)

15. **workflow 단계 미리 정하기는 사람 자격의 저장소에 둔다.** workflow 파일(`workflow.yaml`, `flow.ts`)은 agent가 `EditWorkflow`·file tool로 쓰므로 거기에 단계를 두면 agent가 자기 단계를 올린다(불변식 "agent는 자기 권한을 넓히지 못한다", `workflow.md` 비목표 "unattended approval 규칙 변경"). 그래서:
    - StartBox 폼이 `lophn`·`custom` participant마다 단계를 보이고(기본은 그 agent 정의의 기본 단계, 없으면 전역 기본) 사람이 바꾼다. `StartWorkflow`(user만)에 `participant_modes`를 싣고 instance에 남긴다. 그 instance의 그 participant session은 그 단계로 연다.
    - 폼의 "이 workflow 기본으로 기억"은 core 소유 설정(`approvals.workflow_modes`, key: project + workflow 이름 + participant)에 쓴다. 이 설정은 사람만 쓴다.
    - job이 시작하는 instance는 그 기억된 단계를 쓰고, job 승인 카드가 쓰일 단계를 보인다. job 등록 승인이 그 단계의 허락이다. 승인 뒤 기억된 단계가 ④로 올라가면 그 job은 다시 승인을 받을 때까지 멈춘다("승인 뒤 할 일은 바뀌지 않는다", `job.md`).
    - sub-workflow는 부모 instance의 participant 단계보다 넓어지지 않는다(`min`).
    - harness(coding agent) participant는 이번 범위가 아니다(그쪽 권한은 harness 자신의 것, `roadmap/approval.md`).
16. **전역 기본 단계는 core 설정 `approvals.default_mode`(사람만 쓰기, 처음 값 `workspace`).** agent 정의 `permission_mode`가 비면 이것을 쓴다. 옛 `skip: true`는 `full`, `skip: false`는 칸을 비운다(전역 기본을 따른다).

## 구현 범위

구현자는 이 파일과 `../harness-lab/_report/permission-architecture/spec.md`만 읽는다. 다른 제품의 source와 harness-lab의 다른 파일은 열지 않는다. 이 파일이 spec과 다르면 이 파일이 이긴다. 특히 spec의 단계 이름(`read_only`/`ask`/`workspace`/`full`)은 code 값이고 화면 이름은 제품 2를 따른다. spec의 기본 단계 고정(`workspace`)은 제품 1·기술 16대로 설정값이다.

### 만드는 것

1. **거부 계약과 언마스킹** (기술 2)
   - protocol에 `PermissionDenial`(spec 6.1). `tool_gate/check` 응답을 `run | denied{denial} | rejected | cancelled`(spec 7.3)로.
   - `tool-gate.ts`가 `pattern`을 버리지 않는다. `work.ts`는 `denied`를 spec 6.2 꼴(`reason_kind`, 규칙, 이유, 복구 힌트, 우회 금지 문장)로 싣는다.
   - `work.ts`의 `forbidden`은 handler 문장을 싣는다. `carriesReason`·`INPUT_SCOPED_FAILURES`의 `forbidden` 줄은 필요 없어지면 정리한다. 다른 session·private의 존재를 감추던 handler는 `not_found`인지 확인한다("지금 조용히 막히는 것"의 목록을 모두 본다).
   - `file/scope.ts`의 범위 밖은 제품 5대로 `ask`로 가고, 민감 경로는 `reason_kind: "scope"` 거부.
   - `agent-credentials.ts`의 허락 밖 operation은 `undefined` 대신 이유 있는 거부.
   - MCP 401·다시 로그인은 `missing` 꼴(지금 `ask secret` 문장 붙이는 길)로 model에 간다.
2. **판정 엔진과 규칙** (기술 5·9·10·12): `packages/core/approvals/gate/`에 `evaluatePermission`. 모든 `AskedCall`을 `(category, target)`으로. spec 2의 표(단계 × 범주)를 이 파일 결정대로. `approvals.shell_rules` → 통합 규칙 설정으로 옮기는 data step(사람 규칙 보존). `askIn`의 unattended `run` 제거(제품 3). `ASK_EXTERNAL_WHEN_ATTENDED` 상수는 없애고 command별 "묻기" 칸(제품 6)으로.
3. **shell 스캐너와 `always`** (기술 6·7): `shell-match.ts`를 spec 4대로 다시 쓴다. floor 표는 정규화 뒤 맞춘다. `alwaysPatterns`는 spec 4.6.
4. **단계** (기술 11·16, 제품 1·2): `TurnMode`의 `skip`을 session 단계(`read_only | ask | workspace | full`)로 바꾸고 실행 맥락(`attended | unattended | team_child`)과 가른다. agent 정의 `skip` → `permission_mode`(기술 16)는 data step. 전역 기본 `approvals.default_mode`와 Settings의 고르기(사람만). 대화 화면의 skip 토글 → 단계 고르기(사람 자격만, 기기는 낮추기만). harness agent의 skip(coding agent `--dangerously-skip-permissions` 대응)은 이번에 건드리지 않는다.
5. **승인 선택지** (기술 8, 제품 1): `turn_requests/decide`에 `session`을 더한다. `SessionGrantStore`는 core 메모리, session 끝·재시작에 사라지고 fork에 가지 않는다. 요청마다 `allowed_choices`를 싣고 없는 선택지는 `invalid_input`. 카드(desktop·폰)는 이유·저장될 패턴·"되돌리기 밖" 여부를 보이고 마운트 뒤 300~500ms 동안 Enter를 받지 않는다. 이유 없는/있는 거절의 배치 처리(`tool-batch.ts`).
6. **바깥 폴더** (제품 5): 범위 밖 `file.*` → `ask`(once, session에 그 폴더 열기). 이번 대화에 연 폴더 안 쓰기도 rewind 기록에 넣는다.
7. **앱·MCP·로컬 tool** (제품 6): 할당 줄에 command별 `ask` 칸(사람만). MCP server 설정에 `trust: trusted | untrusted`(기본 `untrusted`, 사람만). 비신뢰 서버의 `readOnlyHint !== true` tool은 `ask`. `<workspace>/.lophn/tools/*`는 `(실제 경로, sha256)`이 data root 신뢰 목록에 있을 때만 실행하고 아니면 `ask`(사람 전용 등급, `once`가 곧 신뢰 기록). `<data root>/tools/`와 workspace 데이터 `tools/`는 agent가 쓰는 곳이라 같은 규칙을 따른다.
8. **workflow participant 단계** (기술 15, 제품 4): `StartWorkflow`의 `participant_modes`, instance 저장 열, StartBox 폼의 단계 고르기와 "기억", `approvals.workflow_modes` 설정, step session을 그 단계로 열기, job 승인 카드의 단계 표시와 올라갔을 때 멈춤, sub-workflow `min`.
9. **사람 쪽 가시성** (기술 3·4): `PermissionDenied` event(폰·원격 allowlist 포함), 타임라인 "막힘" 표시와 복구 버튼, `/permissions` 다섯 칸, Settings › Shell rules → 권한 규칙(범주별, 경고 표시).

### 만들지 않는 것

- OS sandbox, LLM 판정, 훅(`PreToolUse`) 개입. 슬롯만 둔다.
- 사람 없는 실행의 "멈춰 두고 폰으로 묻기".
- workflow 파일(`workflow.yaml`, `flow.ts`) 안의 단계 칸. harness participant의 단계.
- coding agent(harness) 권한 물음의 처리 바꾸기(`roadmap/approval.md`의 남은 것 그대로).
- 저장소(project 폴더) 안의 권한 설정 파일.

### 바뀌는 architecture 문서

- `approval.md`: 원칙 문단, 판정 엔진·단계·실행 맥락, shell 스캐너, `always`, `session` 선택지, 거부 계약·event, 결정 목록(사람의 옛 결정을 뒤집는 줄에는 이 로드맵의 사람 결정을 단다).
- `extension.md`: 로컬 tool 신뢰.
- `agent-definition.md`: `skip` → `permission_mode`.
- `workspace-session.md`: session skip → 단계.
- `settings.md`: 권한 규칙 설정.
- `run.md`, `job.md`, `workflow.md`: unattended `ask`의 처리, participant 단계(`StartWorkflow`, job 승인 카드).
- `project-docs/flows/`의 approvals 흐름, change-log 항목. issue `shell-run-bypasses-file-scope`의 상태를 이 변경에 맞게 갱신.

### 끝나면

- 등록 폴더 밖 파일을 읽으라고 하면 카드가 뜨고, 허락하면 읽고, 거절하면 agent가 이유를 받는다. "tool target is not available"는 범위·정책 거부로는 나오지 않는다.
- 막힌 호출마다 타임라인에 "막힘"과 이유가 보이고 `/permissions`에 남는다. 복구 버튼으로 할당·단계·신뢰를 고치면 다음 메시지에서 된다.
- ③ 단계에서 `npm test`는 처음 한 번 묻고, "이 대화 동안"이면 그 대화에서 다시 묻지 않는다. `ls`, `git status`는 묻지 않는다.
- `sh -c "rm -rf ~"`, `env rm -rf ~`, `rm -r --force ~`는 어느 단계에서도 막힌다. `rm -rf ./dist`의 카드에는 "항상"이 없다.
- 사람 없는 job·workflow에서 묻는 판정은 실행되지 않고 run 결과와 타임라인에 이유가 남는다. 단계가 ④인 participant·agent는 floor·deny 밖에서 돈다.
- Settings에서 기본 단계를 바꾸면 그 뒤 새 대화가 그 단계로 시작한다. 처음 설치는 ③이다.
- workflow를 시작할 때 participant마다 단계를 고르고 기억시킬 수 있고, agent가 workflow 파일을 고쳐서는 단계가 바뀌지 않는다. job이 쓰는 단계가 올라가면 그 job은 다시 승인할 때까지 멈춘다.
- 처음 보는 `.lophn/tools` 스크립트는 한 번 묻고, 내용이 바뀌면 다시 묻는다.
- 옛 skip 켠 agent·session과 사람의 shell 규칙이 옮겨진 뒤에도 같게 돈다.
- 판정 표·스캐너·`always`·data step의 테스트(AGENTS.md가 말하는 곳)와 `npm run check`가 통과한다.

## 조사 문서

- `../harness-lab/_report/permission-architecture/README.md`: 범위, 판정 표, 업계 표준과 갈리는 축
- `../harness-lab/_report/permission-architecture/lophn.md`: 조용한 거부 7, 묻기 누락 7의 코드 원인, "lophn에 들일 때"
- `../harness-lab/_report/permission-architecture/spec.md`: clean-room 명세(구현자가 읽는 유일한 조사 문서)
