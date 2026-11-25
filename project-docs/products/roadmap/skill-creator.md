# skill creator: lophn agent가 skill을 만들고 고치고 정리한다

상태: 로드맵. 2026-11-25 사람이 방향을 냈고 조사(`feature-cleanroom` workflow, harness-lab `_report/skill-creator/`)를 바탕으로 planner가 정리했다. 제품 결정은 2026-11-25 사람이 내렸다("정한 것"). "(agent)"라고 적은 것은 planner의 기술 결정이다. 구현은 "구현 범위"를 따른다.
배경 문서: `project-docs/architecture/{agent-definition,extension,workspace-layout}.md`, `project-docs/products/roadmap/{config-surface,tool-extension}.md`, `project-docs/PRODUCT.md`.

## 사람의 말 (원문)

2026-11-25:

> lophn agent에게 skill creator 스킬 만들어줘
> 조사는 자체 agent loop 있는 하네스 일부만 조사

design에서 세 질문에 (2026-11-25):

> 1. `/` 메뉴에 띄움
> 2. Home + 전역 모두 (Home에서 파일을 못 쓴다는 게 무슨 말인지 묻고, 설명을 들은 뒤)
> 3. 제안은 하고, 만들기는 동의 후

## 왜

- lophn agent는 skill을 읽을 줄만 안다. 만드는 법은 project·app 지침의 두 줄("Skills folder에 file tool로 `SKILL.md`를 쓴다")뿐이다(`packages/core/agent-workspaces/prompts/project.md`, `app.md`).
- 그래서 agent가 만든 skill은 24 KiB를 넘거나 frontmatter가 틀리면 다음 turn에 조용히 빠지고(`discoverSkills().skipped`는 아무에게도 보이지 않는다), 하위 폴더(`references/`)에 둔 부속 문서는 `skill.read`가 찾지 못하며, 설명이 길거나 절차를 요약해 잘못 불리거나 안 불린다. 비슷한 skill이 쌓여도 정리하는 길이 없다.
- Home에서는 아예 만들 수 없다(아래 "지금 코드").

## 지금 코드 (main `227809664`)

- 발견 5층: `builtin < shared < global(<LOPHN_HOME>/skills, 등록 폴더) < project·app(<folder>/.lophn/skills) < workspace-data(<data>/{home,projects/<prj>,apps/<app>}/skills)`. 내장 9종은 모두 `can_disable: false`이고 같은 이름으로 덮을 수 없다(`packages/protocol/lophn-agent/skill-settings.ts`, `packages/core/lophn-agent/extensions/skills.ts`).
- 규칙: `name` `^[a-z0-9]+(-[a-z0-9]+)*$` ≤ 64, `description` 1..1024자, `SKILL.md`와 부속 `.md` 각각 24 KiB(`SKILL_BODY_MAX_BYTES`), symlink 거부, 부속 파일은 `SKILL.md` 옆 평탄 `.md`만(`extensions/skill-read.ts`).
- 매 turn 시작에 다시 발견한다. 이번 turn에 쓴 skill은 다음 turn부터 보인다. `file.write`/`file.edit`는 rewind pre-image를 남긴다.
- 선례: `write-artifact`·`write-workflow`는 "내장 skill + file tool + 검증 명령(`lophn workflow check`)"이다. `agent-definition.md` 비목표 "일의 흐름을 tool로 만들지 않는다".
- Home: `workspaceScope`(`packages/core/agent-workspaces/workspace/workspace-folders.ts`)는 Home에 `skills/`·`tools/` 쓰기를 열어 두었지만 `WORKSPACE_TOOLS.home`(`packages/protocol/lophn-agent/tool-lists.ts`)이 비어 있어 Home은 `file.write`·`file.edit`가 없다. Home agent는 Skills folder 경로를 받고도 쓸 수 없다. 전역 개인 보관소 `<LOPHN_HOME>/skills/`는 어느 workspace도 쓰지 못한다.
- 프롬프트 skill 목록(`packages/core/lophn-agent/prompt-assembly/skill-list.ts`)은 켜진 skill의 설명을 자르지 않고 싣는다.
- 내장 skill 크기는 `tools/check-skills.ts`가 `npm run check`에서 본다. 작성용 검증 명령은 없다. CLI group 이름 `skill`은 이미 `RESERVED_APP_SLUGS`에 있다.

## 다른 제품은 (조사 요지)

Codex·Mixdog·Hermes·oh-my-pi가 수렴한 모양:

- **무엇을 skill로 만들지 않을지**가 핵심이다. 상시 규칙 문서, 기억할 사실, 실행 코드, 일회성 작업, 다른 skill을 가리키기만 하는 skill은 만들지 않고, 비슷한 skill이 있으면 그것을 고친다.
- **설명은 짧고 변별적으로**, 절차를 요약하지 않는다(요약하면 모델이 본문을 안 읽고 설명만 보고 실행한다). 겹칠 때만 "Not for …" 경계를 단다.
- **본문은 짧게, 특정 경우에만 필요한 것은 부속 파일로** 나누고 본문에서 언제 읽을지 적는다.
- **구조 검사(결정적)와 동작 평가(의미)를 나눈다.** 검사기는 frontmatter·이름·크기·깨진 링크·TODO를 잡고, 동작은 힌트 없는 독립 session에 "이름을 말하지 않는 요청"과 "비슷하지만 다른 일"을 주어 본다(Codex·Mixdog).
- **수명주기 셋**: 만들기, 고치기(어느 층의 결함인지 먼저 가르고, 낡은 문장 아래 예외를 쌓지 않는다), 정리하기(Keep / Improve / Merge / Retire 표를 보이고 승인한 것만).
- 내장 skill은 고치지 못하게 막고, 바꾼 것은 다음 turn에 반영한다.
- 갈리는 곳: Hermes·omp는 전용 tool과 turn 뒤 자동 학습(스스로 skill을 만들고 합침)을 두고, Codex·Mixdog는 skill + 일반 file 도구 + 검증 스크립트로 부를 때만 만든다. Codex·Mixdog·Hermes는 agent가 모든 곳에서 쓰는 개인 skill을 바로 만든다.

## 표준을 그대로 가져올 수 없는 곳

1. **전용 skill 쓰기 tool을 두지 않는다.** "일의 흐름을 tool로 만들지 않는다"(`agent-definition.md`)와 `write-workflow` 선례. `file.write`의 범위 가두기·rewind를 그대로 쓴다.
2. **하위 폴더(`references/`, `scripts/`, `assets/`)는 lophn에서 읽히지 않는다.** 부속 문서는 평탄 `<topic>.md`. 실행 코드는 skill 안이 아니라 로컬 tool(`tools/<name>.ts`, `architecture/extension.md`)이나 앱 command다.
3. **24 KiB 하드 상한**이 다른 제품(64~100 KB)보다 훨씬 좁다. 넘으면 조용히 빠진다.
4. **사람의 저장소에 쓰지 않는다**(`project-identity.md`, 사람 2026-11-21). 기본 그릇은 workspace의 Skills folder다.
5. **turn 뒤 자동 학습은 들이지 않는다.** program은 스스로 정해 agent를 부르지 않는다(`AGENT.md`), memory 자동 추출·주기 정리 없음(`agent-definition.md`). 대신 agent가 대화 안에서 제안한다(정한 것 3).
6. **동작 평가는 subagent가 아니라 `lophn team spawn`이다.** 새 session은 방금 쓴 skill을 발견한다. 임시 workspace 격리는 없으므로 부작용 없는 요청으로 한정한다.
7. **lophn의 그릇이 더 많다**: Skill / 로컬 Tool / App / Workflow / Artifact / `LOPHN.md`·`AGENTS.md` / Memory. 판단표가 이 일곱을 가른다.
8. **Home은 지금 파일을 쓰지 못한다.** Home은 기획·위임 자리라 file tool이 없었다. 사람이 Home에서도 skill을 만들게 정했으므로(정한 것 2) Home에 file tool을 주되 쓰는 범위를 skill·tool 폴더로 좁힌다.

## 정한 것

### 제품 (사람)

1. **`write-skill`을 `/` 메뉴에 띄운다.** 사람은 `/write-skill <할 일>`로 만들기·고치기·정리하기를 시작하고, "skill 만들어줘"처럼 말로 해도 된다. (사람, 2026-11-25)
2. **Home에서도 skill을 만들고, 모든 workspace에 보이는 전역 skill도 agent가 만든다.** Home lophn은 Home 전용 skill 폴더, Home 로컬 tool 폴더, 전역 개인 skill 보관소에만 쓸 수 있고 project 폴더·설정·앱 data·agent 정의는 여전히 건드리지 못한다. 잘못 쓴 것은 rewind로 되돌린다. (사람, 2026-11-25)
3. **agent는 같은 절차가 되풀이되는 것을 보면 "이걸 skill로 만들까요?" 하고 먼저 제안할 수 있고, 만들기는 사람이 동의한 뒤에만 한다.** 대화가 끝난 뒤 몰래 만들거나 합치는 일은 없다. (사람, 2026-11-25)

### 기술 (agent)

1. **내장 skill `write-skill`** 하나 + 평탄 부속 `design.md`(작성 규율·정리 체크리스트)와 `evaluation.md`(시나리오 평가·결함 진단). `can_disable: false`, `menu: true`, workspaces `["home", "project", "app"]`. 이름은 내장 skill 이름을 동사-명사로 맞춘 사람의 결정(change-log 0.10.1 `builtin-skill-names-verb-noun`)을 따르고, 설명에 "skill creator"라는 말을 넣어 그 말로도 불린다. (agent)
2. **기본 저장 위치는 그 workspace의 Skills folder**(`<data>/{home,projects/<prj>,apps/<app>}/skills/`). 저장소 `.lophn/skills/`는 사람이 저장소와 함께 나누자고 할 때만, 앱 public skill은 `design-app`의 계약(앱 source `.lophn/skills/`, `lophn.ts` 선언, release)대로. 근거: 사람의 저장소 무쓰기 원칙. (agent)
3. **전역 skill은 Home에서만 쓴다.** Home의 쓰기 범위 = Home `skills/` + Home `tools/` + 전역 개인 보관소 `<LOPHN_HOME>/skills/`(발견기가 `sources.personal`로 읽는 그 폴더). project·app session은 전역을 쓰지 못하고, 사람이 거기서 "모든 곳에서 쓸 skill"을 원하면 Home lophn에게 `lophn call send`로 넘긴다. 근거: 모든 workspace에 닿는 쓰기를 한 자리에 모아 범위 판정·rewind 기록이 단순하다. 정한 것 2의 "Home에서" 그대로다. (agent)
4. **Home tool 목록에 `file.write`·`file.edit`를 넣는다.** `shell.run`은 넣지 않는다. 쓰기 가두기는 지금처럼 `workspaceScope`가 한다. Home workspace info는 `Skills folder`와 함께 `Global skills folder: <LOPHN_HOME>/skills`를 보인다. (agent)
5. **`lophn skill list`와 `lophn skill check <폴더>`를 함께 만든다.** 둘 다 읽기 전용, effect `read`, workspaces `["home", "project", "app"]`. 런타임 발견기와 같은 파서·상한·내장 목록을 쓴다(검사 통과인데 로딩에서 빠지는 일이 없게). `list`는 발견에서 빠진 skill과 이유(`skipped`)까지 보인다. 계약은 spec 3.6. 근거: 검사 없이는 "조용히 빠지는" 결함을 agent가 알 수 없다. `write-workflow`·`workflow check` 짝과 같다. (agent)
6. **프롬프트 목록의 설명은 런타임에서 자르지 않는다.** 짧은 설명은 `write-skill` 지침과 `skill check`의 120자 경고로 유도한다. 근거: 자르면 기존 skill의 트리거가 예고 없이 바뀐다. 목록이 실제로 커지면 그때 다시 본다. (agent)
7. **frontmatter는 `name`·`description` 둘.** 전용 `when_to_use` 칸을 두지 않는다. 새로 만드는 skill은 폴더명 == `name`. (agent)
8. **수명주기 셋(만들기·고치기·정리하기)을 한 skill에 둔다.** 정리하기는 판정표를 보이고 사람이 승인한 것만 고치며, 내장·공유 skill은 고치지 않는다. (agent)
9. **동작 평가는 선택**: 트리거가 다른 skill과 겹치거나 분기가 많거나 실패 비용이 큰 skill에만, `lophn team spawn`으로 힌트 없는 요청 2~5개. (agent)
10. **제안(정한 것 3)은 지침으로만 한다.** program이 되풀이를 세거나 알림을 띄우지 않는다. project·app·home 지침의 Skills 문단에 "같은 절차를 이 대화에서 두 번 이상 했거나 사람이 같은 교정을 되풀이하면 끝에 skill로 만들지 한 줄로 묻는다, 동의 없이 만들지 않는다"를 둔다. unattended turn(job, flow)에서는 묻지 않고 만들지도 않으며, 결과 끝에 제안 한 줄만 남길 수 있다. (agent)

## 구현 범위

구현자는 이 파일과 `../harness-lab/_report/skill-creator/spec.md`만 읽는다. 다른 제품의 source와 harness-lab의 다른 파일은 열지 않는다. Deliverable 판단표, 저장 위치, `SKILL.md` 형식, 수명주기, `skill check` 오류·경고 코드, 동작 평가 절차는 spec 3절을 따르고, 이 파일이 spec과 다르면 이 파일이 이긴다(특히 spec에서 "Q1~Q5에 따름"이라 한 곳은 위 "정한 것"으로 정해졌다: Q1 `write-skill` + `menu: true`, Q2 Home + 전역(Home에서만), Q3 기본 Skills folder, Q4 `skill check`/`list` 함께, Q5 런타임 절단 없음).

### 만드는 것

1. **내장 skill `write-skill`** (`packages/core/agent-workspaces/skills/write-skill/`)
   - `SKILL.md`(목표 ≤ 8 KiB): 진입과 모드 고르기(만들기·고치기·정리하기), Deliverable 판단표(spec 3.2, lophn 그릇 일곱), 저장 위치 표(spec 3.3에 이 파일 기술 결정 2·3을 반영: Home·전역 행은 조건 없이 있고, project·app에서 전역을 원하면 Home lophn에 넘긴다), 세 모드의 핵심 절차(spec 3.5), 검증(`lophn skill check`)과 평가 연결, 제안 규칙(기술 결정 10), 부속 파일을 언제 `skill.read`로 읽을지.
   - `design.md`(목표 ≤ 12 KiB): frontmatter·설명 작성 규율, 24 KiB·평탄 `.md` 규칙, 본문 구조, 앱 public skill 계약, 정리하기 8항목 체크리스트(spec 3.4, 3.5 C).
   - `evaluation.md`(목표 ≤ 8 KiB): 시나리오 세트, 6층 결함 진단, `lophn team spawn` 블라인드 평가와 안전 경계, 수정 전후 비교, 퇴적물 금지(spec 3.5 B, 3.7).
   - `BUILTIN_SKILLS`에 `{name: "write-skill", workspaces: ["home","project","app"], can_disable: false, menu: true}`.
   - 설명(frontmatter `description`)은 120자 안, 무엇을 하는지만: 예 "Create, fix, or clean up skills (skill creator): decide if it should be a skill, write it, check it." 절차 요약 금지.
2. **Home 파일 쓰기**
   - `tool-lists.ts`: `WORKSPACE_TOOLS.home`에 `WORK_TOOLS`. 위 주석("home이 빼고")을 고친다.
   - `workspace-folders.ts`: `WorkspaceFacts`에 전역 개인 skill 폴더(`globalSkillsFolder: string | null`)를 더하고, Home(`workspace === null`)의 `writable`에만 넣는다. 다른 workspace 종류에는 넣지 않는다. 이 값을 채우는 곳은 발견기의 `sources.personal`과 같은 값을 쓴다.
   - `workspace-info.ts`: Home에 `Global skills folder: <path>` 줄.
   - rewind가 Home의 세 폴더 쓰기를 기록하고 되돌리는지 확인한다(이미 `workspaceScope`를 쓰므로 새 폴더가 root로 잡히면 된다).
3. **CLI `lophn skill list` / `lophn skill check <폴더>`** (`packages/cli/commands/skill.ts`, core route, protocol schema)
   - spec 3.6의 출력 모양과 오류 11종·경고 6종. 파서·상한·내장 목록은 `extensions/skills.ts`의 것을 그대로 부른다(복제 금지).
   - `check`의 `<폴더>`는 그 session의 읽기 범위 안만. 범위 밖이면 `forbidden`.
   - `list`는 그 session workspace에서 보이는 skill(`name`, `source`, `enabled`, `can_disable`, `description`, `path`)과 `skipped`(`path`, `reason`).
   - 사람 터미널·coding agent도 같은 명령을 쓴다(사람 자격일 때 workspace는 `--project`/`--app` 또는 Home).
4. **지침** (`packages/core/agent-workspaces/prompts/{home,project,app}.md`)
   - Skills 문단: skill을 만들거나 고치거나 정리할 때는 `write-skill`을 먼저 읽는다 + 제안 규칙(기술 결정 10) 한두 줄. Home 지침에는 Home Skills folder와 Global skills folder의 차이 한 줄.
   - 지침에서 "Home은 파일을 쓰지 않는다"는 뜻의 문장이 있으면 skill·tool 폴더 예외로 고친다.

### 만들지 않는 것

- 전용 skill 쓰기 tool(`skill_manage` 류), skill 편집 GUI.
- turn 뒤 자동 학습·자동 합치기·주기 정리, 되풀이를 세는 program 쪽 감지나 알림.
- 하위 폴더 부속 파일 지원(`references/` 등)과 skill 안 스크립트 실행.
- 프롬프트 skill 목록의 런타임 절단·예산.
- `when_to_use` 같은 새 frontmatter 칸.
- project·app session의 전역 skill 쓰기, Home의 `shell.run`.
- 원격 skill 허브 설치·출판.
- 기존 내장 skill 설명 정리(필요하면 별도 작업).

### 바뀌는 architecture 문서

- `agent-definition.md`: 51번(내장 skill 목록에 `write-skill`, `/` 메뉴), 47번(전역 보관소는 Home session이 file tool로 쓴다), tool 목록 절(Home도 `file.write`·`file.edit`, 범위는 skill·tool·전역 skill 폴더), `lophn skill` 명령.
- `workspace-layout.md`: Home의 쓰기 범위에 전역 개인 skill 폴더, workspace info의 `Global skills folder`.
- `extension.md`: Home `tools/`를 이제 Home agent가 실제로 쓸 수 있음.
- `project-docs/flows/`(`areas.yaml`의 agent 정의·내장 skill 영역): `write-skill`, `lophn skill list/check`, Home 파일 쓰기.
- change-log 항목(내장 skill 추가, Home file tool, `lophn skill` 명령).

### 나누기

단일 줄(`feat/skill-creator`). 순서: (a) protocol(`BUILTIN_SKILLS`, Home tool 목록, `skill` route schema) → (b) core(`workspace-folders`·`workspace-info`, `skill list/check` route) + CLI → (c) 내장 skill 세 파일과 지침 → (d) architecture·flows·change-log.

### 끝나면

- project·app·Home 어디서나 `/write-skill`이 메뉴에 뜨고, "skill 만들어줘"로도 `write-skill`을 읽고 시작한다.
- Home lophn이 Home Skills folder와 전역 skill 폴더에 skill을 쓰고, 다음 turn에 Home에서(전역이면 모든 workspace에서) 목록에 보인다. Home의 그 밖의 곳(project 폴더, `agents/`, `secrets.json`, 앱 data, `settings.json`)에 대한 `file.write`는 `forbidden`이다. project·app session의 전역 폴더 쓰기도 `forbidden`이다. Home에서 쓴 것은 rewind로 되돌려진다.
- `lophn skill check`가 정상 skill에 `ok: true`, spec 4절의 각 결함에 맞는 코드를 돌려준다. 런타임 파서가 거절하는 입력은 `check`도 반드시 실패한다.
- `lophn skill list`가 24 KiB 넘는 skill을 `skipped`에 경로·이유와 함께 보인다.
- 내장 skill 세 파일이 각각 24 KiB 안이고 `SKILL.md` ≤ 8 KiB이다.
- `npm run check`가 통과한다.

## 조사 문서

- `../harness-lab/_report/skill-creator/README.md`: 범위, 판정 표, 업계 표준과 갈리는 축
- `../harness-lab/_report/skill-creator/lophn.md`: 지금 lophn과의 대조, "lophn에 들일 때"
- `../harness-lab/_report/skill-creator/spec.md`: clean-room 명세(구현자가 읽는 유일한 조사 문서)
