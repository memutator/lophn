# domain

domain은 그릇(project나 app) 하나 안에 있는 책임 경계다. entity이고 id는 `dom_`이다. domain마다 kind 파일, `DOMAIN.md`, skill, artifact가 있고, 앱의 domain에는 앱 tool이 있다. agent가 받는 최소 context와 domain 사이 장치(공개 tool 거르기, 공개 tool을 지우는 release의 알림, lophn 지도)의 단위가 domain이다. 그릇은 경계가 아니다. 이 경계가 흐려지면 agent가 맡지 않은 domain의 지침과 비공개 tool을 받거나, 다른 domain이 쓰는 공개 tool이 말없이 지워지거나, 앱의 tool이 어느 domain 것인지 아무도 모른다.

여러 곳에 걸친다.
- 값: `packages/protocol/domains/`(id·이름·owner `values.ts`, route·event `domains.ts`, port `ports.ts`, 자리 `paths.ts`, artifact 값 `artifact.ts`)
- core module: `packages/core/domains/`(표, command, 읽기, lookup, port, agent tool `domain.read`·`domain.create`)
- 그릇 확인: `packages/core/main/daemon/wiring/domains-registration.ts`(`ownerLookupPort`)
- 앱의 첫 domain: `packages/core/apps/registration/commands.ts`의 `create`(`domainProvisioningPort`)
- 맡은 domain: `packages/core/lophn-agent/agents/resolve.ts`
- 지침 층: `packages/core/lophn-agent/instructions/`
- skill 층: `packages/core/lophn-agent/extensions/skills.ts`
- place 정보와 file 범위: `packages/core/agent-places/place/`
- tool 거르기: `packages/core/lophn-agent/tools/app-public.ts`, `app.tool_index` route(`packages/core/apps/declaration/reads.ts`의 `createToolIndexRead`, 명령 `app.tools`)
- 공개 tool 장치: `packages/core/apps/releases/public-tools.ts`, `packages/core/apps/usage/`
- kind 파일과 위반: `architecture/kinds.md`(`packages/core/projects/kinds/`), artifact: `architecture/artifact.md`

## 흐름

```
 그릇 ── project(폴더 작업 공간) | app(software 작업 공간)
   └─ domain N개. 앱은 1개 이상, project는 0개도 된다
        domain.create ── project·app place의 session은 그 그릇에, 사람은 어느 그릇에든. Gate 없음
        app.create ───── 같은 tx에서 앱 slug 이름의 domain 하나 (domainProvisioningPort)
        domain.archive ─ 사람만. 앱의 마지막 active domain은 conflict

 <data>/domains/<dom>/
   DOMAIN.md   ── 그 domain을 받은 그릇 place의 session이 file tool로 쓴다 ──▶ 지침 층(그 domain을 받은 session만)
   kinds.yaml  ── 같은 쪽 ──▶ kinds worker(glob은 그릇 폴더 기준) ──▶ 새 위반이면 KindViolationFound(남지 않는 event, 사람에게 toast)
   skills/     ── 같은 쪽 ──▶ skill 층(내장 < 전역 < domain)
   artifacts/  ── 같은 쪽 ──▶ sidebar Artifacts, 봉한 view

 앱 선언 ── tools[]: { name, …, public, domain: <그 앱의 domain 이름> }
   release 준비(release 기록 command, preview bundle 사본)·declaration.check·activation 직전 재검사 ── 앱의 active domain 이름 안에 있어야 한다

 turn ── ResolvedAgent.domains(맡은 domain id) ──▶ ToolContext.domains
   정의의 domains가 비면: session place 그릇의 active domain 전부
   있으면: 그 가운데 그 그릇에 있는 것만(0개일 수 있다)
   home: 없다(place가 없다)
     지침   전역 → LOPHN.md(project 그릇만) → DOMAIN.md(맡은 domain을 이름순으로) → agent 본문
     place  Domains 절(이름, 제목, 목적, 폴더), domain별 kind 글, domain별 artifact 목록
     tool   할당된 앱 가운데 맡은 domain의 tool 전부 + 다른 domain의 public tool   (이름 <domain>_<tool>)
     file   project: project 폴더 + 받은 domain 폴더 + project의 workflows/ / app: 앱 source + 받은 domain 폴더
            home: 모든 project 폴더를 읽기만

 domain 사이
   app.usage ── (쓰는 domain = 부른 agent가 맡은 domain) × (tool의 domain). 같은 domain 안의 사용은 세지 않는다
   release가 다른 domain이 쓰는 public tool을 지운다 ──▶ release.prepare 결과의 removed_public_tools (막지 않는다)
   마지막으로 쓴 session이 없는 artifact annotation ──▶ domain의 owner 그릇 place의 lophn session
   lophn 지도 ── domain마다 owner, 목적, public tool, 그것을 쓰는 다른 domain. package는 주인 앱 줄에
```

## 지키는 것

- **domain은 그릇 하나에 속하고 owner를 바꾸지 않는다.** owner는 `{kind: "project" | "app", id}`다. 이름은 slug이고 보관한 것까지 모든 domain에서 하나다(`domains.name` UNIQUE). 이름 바꾸기와 그릇 옮기기는 없다. `id`, `name`, owner 열은 trigger가 바꾸지 못하게 한다.
  - 이름이 하나뿐이고 `_`가 없어 agent tool 이름 `<domain>_<tool>`에 앱 id가 없어도 겹치지 않는다. 내장 tool 자원 이름(`file`, `app`, `release`, `job` …)과 `call`, `reply`, `cancel`, `ask`, `mcp`는 domain 이름으로 쓰지 못한다(`packages/protocol/apps/declaration/types.ts`의 `RESERVED_DOMAIN_NAMES`). 그래서 이름이 이 낱말 하나인 앱은 만들 수 없다(앱 slug가 domain 이름이 된다).
- **`domains` module은 projects·apps를 import하지 않는다.** `domain.create`가 그릇이 있는지 보는 길은 wiring이 꽂는 `ownerLookupPort`다. 앱을 만드는 command는 `domainProvisioningPort`로 같은 tx 안에서 domain을 만든다. 그 command가 이미 그릇을 확인했으므로 provisioning은 owner를 다시 보지 않는다.
- **앱은 domain이 0개가 되지 않는다.** `app.create`가 같은 tx에서 `{name: slug, title: name, purpose: description, owner: app}`을 만든다. 그 이름이 이미 있으면 앱도 만들지 않는다(`conflict`). 앱의 마지막 active domain은 보관하지 못한다. project는 domain이 0개여도 된다(폴더와 coding만 쓰는 project).
- **`domain.create`는 Gate에 묻지 않는다.** 그릇 안에 만드는 것이라 권한이 넓어지지 않는다. agent는 자격 조건(`conditions.project`·`conditions.app`)의 그릇에만 만들고, 조건이 없는 agent(lophn)는 만들지 못한다. id를 미리 정하는 것과 보관·되살리기는 사람만 한다.
- **읽기는 그릇 안이다.** 자격 조건이 있는 agent는 자기 그릇의 domain만 읽고 다른 그릇은 `not_found`다. 조건이 없는 agent와 사람·machine은 전부 읽는다. agent tool `domain.read`는 `domain`을 생략하면 부른 agent의 place 그릇의 domain을 주고(place가 없는 lophn에게는 전부), 주면 그 domain 하나를 같은 범위 검사로 읽는다.
- **prompt·tool·file 범위의 단위는 맡은 domain이다.** 같은 그릇 안의 다른 파일을 읽는 것은 막지 않는다. 사람은 공격자가 아니고, 막을 것은 agent의 실수다. 폴더 경계와 rewind가 그것을 막는다.
- **`DOMAIN.md`는 맡은 domain의 것만 읽는다.** reader는 session의 place 그릇이 그 domain의 owner일 때만 열고, 아니면 `forbidden`이다(`instructions/files.ts`). 맡은 domain의 파일만 읽고 다른 domain에는 읽기 요청도 내지 않는다. 한 domain이라도 크기 상한을 넘거나 UTF-8이 아니면 다른 층처럼 turn을 시작하지 않는다. 없는 파일은 건너뛴다.
  - 이은 글이 24000자(`DOMAIN_TEXT_BUDGET`)를 넘으면 넘은 domain부터 본문 대신 목적 한 줄과 "full text: read DOMAIN.md"만 싣는다. domains를 고르지 않은 agent는 그릇의 domain을 모두 받으므로 domain이 많으면 여기에 걸린다.
- **`DOMAIN.md`·`kinds.yaml`·`skills/`·`artifacts/`는 그 domain을 받은 그릇 place의 session이 쓴다.** 넷 다 Gate 없이 file tool로 쓰고 rewind로 되돌린다. 지침 Gate는 project의 `LOPHN.md`뿐이다.
  - rewind의 쓰기 폴더는 그릇의 domain 폴더 전부로 넉넉히 잡는다. 실제 쓰기는 file tool이 받은 domain으로 좁힌다(`placeScope`).
  - project의 `workflows/`는 그 project place의 session이 읽고 쓴다. app place와 home에는 열리지 않는다. rewind의 쓰기 폴더(`placeScope(...).write`)도 같이 따른다(`architecture/workflow.md`).
- **앱 tool의 `domain`은 필수이고 그 앱의 active domain 이름이어야 한다.** 정본 검사 `validateDeclaration`에 앱의 domain 목록을 주는 곳은 넷이다: release를 기록하는 command `release.record`(`packages/core/apps/releases/commands.ts`, 준비의 검사가 끝난 뒤라 domain이 틀리면 release가 생기지 않는다), release 준비의 preview bundle 사본(`createCopyPreviewBundles`), `declaration.check`, activation 직전 재검사. 목록을 읽지 못하면 `unavailable`이다. 모든 domain이 보관된 앱은 모든 tool이 거절된다.
- **다른 domain의 비공개 tool은 보이지 않는다.** 앱 할당이 있어도 agent의 tool 목록에도, `app.tools` 결과에도 없다. 같은 앱의 다른 domain이라도 그렇다(경계는 앱이 아니라 domain이다). tool의 domain을 읽지 못하면 비공개로 본다(막는 쪽으로 실패한다).
  - Grants 탭(할당 편집)은 맡은 domain의 tool이나 어느 domain의 public tool만 후보로 보인다. core의 할당 쓰기(`packages/core/approvals/assignment/`)는 domain을 검사하지 않으므로 agent에게 막는 곳은 이 목록 거르기 하나다.
  - job이 연 tool run(program caller)과 flow instance가 연 tool run(flow caller)에는 목록이 없어서 부를 때 같은 규칙으로 거른다. job을 만든 agent(flow는 `workflow.yaml`의 `agent`, 없으면 lophn)가 그 place에서 받는 domain의 tool이나 public tool이 아니면 `denied`다(`packages/core/apps/calls/gate.ts`, 맡은 domain 셈은 사용 관계와 같은 `packages/core/main/daemon/agent-domains.ts`. `architecture/app-call.md`, `architecture/job.md`).
- **사용 관계의 쓰는 쪽은 부른 agent가 맡은 domain이다.** tool 자신의 domain과 같은 사용은 세지 않는다. 한 agent가 domain 여럿을 맡으면 domain마다 센다. 다른 domain이 쓰는 public tool을 지우는 release는 막지 않는다. `release.prepare`가 결과의 `removed_public_tools`에 그 tool과 쓰는 domain 이름을 싣고(`removedPublicToolsOf`), release한 session이 쓰는 쪽에 알리거나 tool을 되살린다. 쓰는 쪽은 부를 때 `not_found`로 알게 된다. 막기는 쓰는 쪽을 깨우는 reaction과 짝이었고, reaction이 없으면 agent가 이유를 모르는 gate가 된다.
- **domain의 일을 받는 쪽은 그 그릇 place의 lophn session이다.** owner를 읽어 그릇 place를 정한다(`packages/core/main/daemon/wiring/router.ts`의 `ownerOfDomain`). 마지막으로 쓴 session이 없는 artifact annotation이 여기로 간다. owner가 보관됐거나 없으면 `not_found`다. 새 kind 위반은 agent를 열지 않고 사람에게 toast만 간다(`architecture/kinds.md`).
- **package 주인은 domain이 아니라 앱이다(`owner_app`).** package는 앱 코드에서 publish된다. 다른 그릇에서 난 package bug는 그 앱 place의 lophn에게 call한다.
- **skill 층은 내장 < 전역 < domain이다.** domain 층 skill은 domain마다 따로 남고, agent가 맡은 domain으로 거른 뒤에 이름마다 하나를 고른다(`pickSkills`, `packages/core/lophn-agent/extensions/skills.ts`). domain skill이 같은 이름의 전역 skill을 이기고, domain끼리는 이름이 앞서는 domain이 이긴다. 맡지 않은 domain의 skill은 같은 이름의 전역 skill을 가리지 않는다. 내장 skill은 모두 끌 수 없어 같은 이름의 사람 skill에 덮이지 않는다(`mergeSkillLayers`).

## 왜 이 모양인가

- **경계를 그릇이 아니라 domain에 둔다.** 저장소 하나(project)에도 업무가 여럿이고, 앱 하나에도 다루는 객체가 여럿이다. 그릇을 경계로 두면 project 하나가 커질 때 agent가 모든 지침과 tool을 받는다. 그릇은 폴더·source·release를 주는 작업 공간으로 남긴다.
- **domain을 다른 그릇에 또 만들지 않고 공개 tool로 참조한다.** 같은 업무를 두 곳에 두면 뜻이 갈라진다. 다른 그릇은 할당으로 public tool을 받아 쓰고, 지우는 release는 준비 결과에 드러난다.
- **`DOMAIN.md`는 place 정보가 아니라 지침 층에 둔다.** 사람이 쓴 지침이라 조용히 빼지 않는 층 규칙(`architecture/agent-definition.md`)을 그대로 받는다. place 정보는 program이 만든 목록만 싣는다.
- **domain을 받은 session은 그 domain의 계약과 artifact를 모두 쓴다(사람, 2026-10-28).** 예전에는 사람이 만든 agent가 artifact만 쓰고 계약은 project의 담당 agent에게 call했다. role이 없어지며 버그를 찾은 agent가 고친다.
- **domain 이름을 모든 domain에서 하나로 둔다.** agent tool 이름, 사용 관계, 화면이 이름 하나로 domain을 가리킬 수 있다. 바꾸기를 두지 않아 이름이 곧 신원처럼 쓰인다.
