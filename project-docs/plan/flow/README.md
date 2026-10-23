# flow: program이 이끄는 workflow

- **목표:** `kind: flow` workflow를 사람과 job이 시작할 수 있게 한다.
  - flow의 code(`flow.ts`)는 workflow 폴더에 `workflow.yaml` 옆에 있고 PM이 쓴다.
  - instance가 시작되면 lophn이 그 code를 sandbox 안 process 하나로 띄운다.
  - code는 lophn이 주는 SDK로만 바깥과 닿는다: agent 부르기(run), 앱 tool 부르기, report.
  - 기록과 화면은 `kind: agent` workflow와 같다. lophn은 report를 믿고 기록할 뿐 판정하지 않는다.
- **재료:**
  - roadmap `project-docs/products/roadmap/workflow.md`: "원칙", "남은 일" 1·2, "정한 것"(2026-10-23 code의 자리), "정할 것" 1, "끝남 기준", "하지 않는 것"
  - roadmap `headless-schedule.md`: flow의 모양(층 표, "정한 것 (agent)", 뉴스 구독 예)
  - architecture:
    - `workflow.md`: 정의, instance와 줄, report, 멈춤, 켤 때, 쓰기 범위
    - `run.md`: `RunService.start(input, origin)`, 끝을 아는 법, 켤 때
    - `app-call.md`: program caller, 부른 쪽 확인, 손 사본 parser(`wire.ts`)
    - `job.md`: program caller의 판정(만든 agent의 할당과 domain), `workflow_start`
    - `approval.md`: unattended, "할당이 허락", job이 할당을 넓히지 못하는 까닭
    - `activation.md`와 `packages/core/apps/permissions/flags.ts`: 앱 process의 sandbox flag
    - `layers.md`: feature module은 서로 import하지 않는다
    - `domain.md`: 비공개 tool 거르기
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - flow가 step을 agent에게 넘기기(`kind: agent`의 넘기기). flow는 agent를 run으로 부른다.
  - flow를 다시 돌리기. 켤 때도 다시 띄우지 않는다.
  - 서드 파티 harness 참가자, domain artifact의 node 그림(roadmap `workflow.md` "남은 일" 3·4).
  - CLI `lophn workflow report`의 자격 바꾸기. 사람의 길로 그대로 둔다.
  - 새 e2e와 eval. 있는 e2e는 land가 돌리고 통과해야 한다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `fl-`로 시작한다.
- **시작 조건:** 없다. `bug-sweep`과 같이 돌 수 있다. `bs-jobs`(`packages/core/jobs`)와 소유가 겹치는 task는 `status.py ready`가 거른다.

## 정한 것

roadmap `workflow.md`의 원칙(lophn program은 약하다)과 정한 것을 따른다. 아래는 이 계획에 걸려 정한 것이다. 2026-10-23 사람이 "flow code는 workflow 폴더"를 고른 뒤 planner가 정했다(agent). 근거는 줄마다 적는다.

선언
- **`kind: flow`의 code는 workflow 폴더의 `flow.ts` 하나다.** 이름을 선언에 적지 않는다. lophn이 읽는 칸이 하나 덜하다. `flow.ts`는 같은 폴더의 다른 file을 import할 수 있다.
- **lophn이 flow 선언에서 읽는 것은 `kind`와 `steps`의 key뿐이다.** step 이름은 화면과 report의 자리다. step의 다른 칸(`by`, `prompt` 등)은 두고 읽지 않는다. `participants`도 읽지 않는다. `steps`가 없으면 틀린 선언이다.
- `flow.ts`가 없으면 그 workflow는 시작할 수 없고 목록의 `problem`에 그 이유가 실린다(`not_agent`는 없어진다).

process
- **instance 하나에 process 하나다.** 시작할 때 띄우고, code가 끝나면 끝난다. 다시 띄우지 않는다(자동 재시도 없음, roadmap `headless-schedule.md`).
- **sandbox는 앱 process와 같은 꼴이다.** AI가 짠 code라 막을 것을 막는다(AGENTS.md "속도").
  - 읽기: 그 workflow 폴더와 설치된 SDK(`<data>/sdk`)뿐이다.
  - 쓰기, 네트워크, 다른 program 실행, 환경 변수는 없다. 바깥 효과는 모두 앱 tool과 agent를 거친다. 그래야 invocation 기록과 rewind가 선다.
  - flag는 `--no-prompt --no-config --no-remote --no-npm --cached-only --no-lock`와 SDK import map이다. 앱의 `appFlags`를 본보기로 한다.
- **lophn과는 stdin과 stdout의 JSON 줄로 말한다.** lophn이 쥔 진입 file이 code를 import하기 전에 `console`을 stderr로 돌린다. 그래서 code의 `console.log`가 통로를 깨지 않는다. JSON이 아니거나 id가 없거나 너무 긴 줄이 오면 그 instance의 process를 끝낸다. 읽히지만 칸이 틀린 요청은 `invalid_input` 실패 값으로 돌려준다(오타 하나로 flow 전체가 죽지 않게).
- **stderr는 instance마다 log file에 redaction을 거쳐 남긴다.** 자리는 data root의 lophn 쪽이다(PM의 workflow 폴더가 아니다). process가 끝날 때 끝 몇 줄이 줄(아래 `program_exited`)에 실린다.
- 띄우는 쪽은 `packages/core/supervision`의 `spawnProcess`를 쓴다. platform supervisor(`createSupervisor`)는 끝난 child를 다시 띄우고 stdout을 frame 통로로 쓰므로 쓰지 않는다.

SDK
- **새 SDK package `@lophn/flow`(`packages/sdk/flow`).** 다른 SDK처럼 `<data>/sdk`에 설치하고 앱과 같은 import map 꼴로 푼다. 내놓는 것은 다섯이다.
  - `input`: 시작 입력 글. `instance`: instance id.
  - `agent(...)`: agent 하나를 run으로 부르고 끝날 때까지 기다려 답을 준다. 실패도 값으로 준다(던지지 않는다). 다시 할지는 code가 정한다.
  - `tool(...)`: 앱 tool 하나를 run으로 부르고 결과를 준다. 막히거나 실패한 것도 값이다.
  - `report(...)`: step, 글, `next?`. `kind: agent`의 report와 같은 뜻이다.
- 오래 걸리는 agent run은 lophn 쪽이 `wait`를 거듭 불러 기다린다(`RUN_WAIT_MAX_MS` 60초). code는 기다리는 법을 몰라도 된다.

자격
- **flow의 앱 tool 호출은 그 project PM의 지금 할당과 맡은 domain 안에서만 된다.** job의 program caller와 같은 판정이다(`architecture/job.md`, `approval.md`). code를 쓴 것이 PM이라, code로 PM의 할당을 넓히지 못하게 한다. 사람은 PM에게 그 앱을 할당해야 flow가 그 tool을 쓴다.
- **flow가 부르는 agent는 누구든 된다.** run과 같다. 받은 agent는 자기 할당으로만 일한다(AGENT-ROLE T5, T6). 입력은 unattended다.
- **program caller와 run origin을 job에서 떼어 낸다.** origin은 job과 workflow instance 둘 가운데 하나다. run 기록은 그 run을 연 instance도 갖는다(job 칸과 나란히). program caller wire는 둘을 가른다. 앱 process의 손 사본 parser(`packages/core/apps/runtime/entrypoint/wire.ts`), `sdk/cap-tool`, invocation의 `caller_kind`까지 같이 고친다. 하나라도 빠지면 그 호출이 말없이 거절된다(`architecture/app-call.md`).
- **origin과 flow 자격은 route 입력이 아니다.** 모두 core 안에서 만든다. flow process에는 credential을 주지 않고, 통로로 온 요청을 core가 그 instance의 이름으로 한다(`run.md`의 "origin은 route 입력이 아니다").

instance와 줄
- **시작은 사람(화면, CLI)과 job이다.** agent에게 시작 tool이 없는 것은 그대로다. flow의 `started` 줄에는 step이 없다. 지금 step은 code가 report한 step이다.
- **줄의 `by`에 `program`이 생긴다.** flow가 낸 report가 이것이다.
- **새 줄 `program_exited`.** process가 끝나면 끝 code와 stderr 끝 몇 줄을 남긴다. 그때 instance가 `running`이면 `ended`로 닫는다(by lophn). 남은 참가자가 없어 아무도 이어 갈 수 없기 때문이다. lophn은 성공인지 판정하지 않는다. 끝 code와 글이 그대로 보일 뿐이다.
- **멈추기(`StopWorkflow`)는 process를 죽이고, 그 instance가 연 run을 취소하고, `stopped`로 닫는다.**
- **켤 때 `running`인 flow instance는 process가 없다.** `lophn_restarted` 줄(받은 session 없음)을 남기고 `ended`로 닫는다. 다시 띄우지 않는다. 바깥 효과가 두 번 나지 않게 한다. job이 시작한 instance였으면 그 job run은 다음 바퀴에 `done`으로 닫히고, 다음 차례는 평소대로 돈다.
- 줄 종류가 늘고 칸이 nullable이 되어 `workflow_lines`의 CHECK가 바뀐다. migration이 없으니 개발 data를 새로 만든다.

PM
- **`workflow.check` tool을 더한다(PM만).** `flow.ts`를 실행하지 않고 type check만 한다. `blueprint.check`(`packages/core/apps/blueprint/check.ts`)를 본보기로 한다. PM은 instance를 시작하지 못하므로 쓰고 나서 볼 길이 이것이다.
- 내장 skill `guide-workflows`에 flow 절을 쓴다: `flow.ts`의 꼴, SDK 다섯, sandbox(바깥 효과는 앱 tool로), 할당(사람이 PM에게 앱을 할당해야 한다), `workflow.check`, 실패 처리와 다시 하기는 code의 일이라는 것.

화면
- workflow 탭에서 flow도 시작한다. 시작 입력은 `kind: agent`와 같다.
- instance 화면은 같다. `by: program`을 "Program"으로 보이고 `program_exited` 줄은 끝 code와 stderr 끝 줄을 보인다.
- sidebar의 "Flow · can't be started here"를 지운다.
- 화면 모양이 크게 바뀌지 않아 wireframe 승인 관문을 두지 않는다. 화면 task가 gallery의 workflow page를 같이 맞춘다.

job
- `workflow_start`는 flow도 시작한다. 시작이 되면 job 쪽은 바뀔 것이 없다. job tool 설명만 고친다.

## 위험 test

`write-test` 기준으로 넷만 둔다.
- flow process는 sandbox 밖을 쓰지도 네트워크로 나가지도 못한다(flag를 만드는 순수 함수의 결과로 본다. process를 띄우지 않는다).
- flow의 앱 tool 호출은 PM의 할당 밖이나 맡지 않은 domain의 비공개 tool이면 `denied`다.
- 앱 process의 caller parser가 새 program caller를 protocol schema와 같게 받는다(`wire.ts` parity).
- 켤 때 `running`인 flow instance는 `lophn_restarted` 줄과 함께 `ended`가 되고 다시 띄워지지 않는다.

진짜 flow process를 띄워 끝에서 끝으로 도는 test는 subprocess라 사람에게 먼저 묻는다(AGENTS.md).

## lead가 할 일

- 계약 task가 고정되기 전에는 다른 task를 띄우지 않는다.
- 등록: `protocol/mod.ts`, core 조립 목록(`WIRINGS`, `TEAMS`)은 brief의 "등록할 것"대로 lead가 merge 뒤 고친다. SDK는 `installSdkCopies`가 `packages/sdk/*`를 모두 깔아 따로 등록하지 않는다. module-catalog는 `packages/core/main`과 `packages/sdk` 단위라 새 줄이 없다. role tool 목록의 `workflow.check`는 `fl-check`가 고친다(목록에 없는 tool은 test가 막는다).
- 화면 task를 merge할 때 `deno run -A packages/shell/renderer/build.ts`를 돈다.
- 다 끝나면:
  - architecture: `workflow.md`(flow 절 새로), `run.md`(origin), `app-call.md`(program caller), `job.md`(flow 시작), `approval.md`(flow 호출의 판정), `layers.md`(새 module이나 port가 생기면), `domain.md`(flow 호출의 domain 거르기).
  - `project-docs/products/AGENT-ROLE.md`: flow가 agent를 부르는 때, PM이 flow를 쓰는 때.
  - roadmap `workflow.md`와 `headless-schedule.md`에서 land된 것을 지운다.
  - changelog 새 열린 판 `project-docs/products/change-log/0.8.0.md`를 만들어 항목을 쓰고(0.7.0은 닫혔다) 개발 data를 새로 만든다는 줄을 넣는다.
  - 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부, subprocess·Worker·서버·브라우저를 띄우는 새 test. 그 밖은 planner에게 묻는다.
