# folder-guidance

앱 agent가 읽는 지침을 쓴다: `design-app` skill 옆의 bundled file `folder-sync.md` 하나(언제 `sync_to`를 쓰나, 사람의 환경과 memory로 정책 고르기, 이 기계에 destination 두기, 폴더를 옮기는 바깥 도구를 깔고 설정하기, 스스로 맞추지 않는 도구의 예약, 암호화, 사람에게 말할 것, 한계), `SKILL.md`의 가리키는 말 한 구절, 앱 template `AGENTS.md.tmpl`의 `sync_to` 두 줄, 그리고 이 판 메모의 `## Instruction diff`.

- 단위: sdk (wave 3)
- 선행: folder-decl, folder-surface. `folder-decl`은 wave 1, `folder-surface`는 같은 wave 3이다(명령 이름과 출력이 지침에 들어간다)
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/skills/design-app/folder-sync.md`(새 file)
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`(가리키는 구절 하나)
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`(`runs_on` 단락 뒤 `sync_to` 줄)
  - `packages/core/agent-workspaces/skills/migrate-sdk/declaration-4.9.0.md`(`## Instruction diff`. `folder-decl`이 만든 메모. main의 판이 다르면 그 이름)
- 읽을 것:
  - skill `.claude/skills/sdk-note/SKILL.md`("Instruction diff": git이 낸 diff, 바뀐 hunk만, 영어 명령형, lophn 저장소 path·계획 이름을 쓰지 않는다)
  - 꼴의 본보기: `design-app/phone-apps.md`(같은 독자, 같은 말투: 영어, 짧은 명령형, 먼저 고르기), `SKILL.md`의 bundled file을 가리키는 단락(~l.300, `skill.read({ name: "design-app", path: "<file>" })`). `SKILL.md`는 24,576 bytes 한도에 거의 닿아 있다(구절 하나, 160 bytes 안)
  - 계획 `README.md`("정한 것" 전부, "사람이 정할 것"의 Drive for desktop 추천, 계약 5·7), `reports/multi-machine/program.md`(정책 13, 15, 16)
  - roadmap `project-docs/products/roadmap/multi-machine.md` "모양" 3, 6과 "되는 것과 한계"
  - 조사: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 8.2(살아 있는 DB를 공유 저장소에 둔 비용, secret이 든 backup), 12.3(agent는 읽고 제안, 연결은 사람 승인), 14 (iii) 6·7·16
  - 겉: `folder-surface` 보고의 `machine.environment` 출력 예, `folder-decl`의 SDK guide `sync_to` 단락
- 계약:
  - 쓰는 것: CLI `machine.environment`, `app.take_in`, `release.activate`, `lophn settings get|set folder.destinations`, 선언 `sync_to`
  - 내놓는 것: 없음(지침)

## 할 일

1. `folder-sync.md`(영어, 24 KiB 안, 절 순서는 아래):
   - **Pick `sync_to`**: 기본은 없음(이 기계에만). 사람이 이 앱을 다른 컴퓨터에서도 쓰거나 data가 다른 기계에 있어야 하면 쓴다. 먼저 `lophn machine environment`로 기계와 destination을 보고 workspace memory에서 사람이 말한 환경(기계, 쓰는 cloud, 이미 쓰는 동기화 도구)을 찾는다. 앱마다 다르다: 민감한 data, 한 기계의 상태(창 위치 같은 것)는 내보내지 않는다. destination 이름은 사람이 알아볼 짧은 이름(`personal`, `work`)이고 모든 기계에서 같은 이름이다.
   - **What syncing asks of the app**: `runs_on` phone 앱과 같은 data 규칙(text id `newId()`, 정수 PK·AUTOINCREMENT·trigger·PK 밖 UNIQUE·CHECK 금지, `@lophn/cap-store` 2.0.0 이상)과 그 이유 한 줄, 같은 칸을 두 기계에서 고치면 나중 것이 말없이 이긴다, 두 기계가 같은 release일 때만 맞는다.
   - **Set up a destination on this machine**: destination은 사람이 승인한다. 요청하기 전에 쉬운 말로 먼저 설명한다: 어느 앱의 무엇이 이 기계의 어느 폴더에 쓰이는지, 그 폴더를 어느 도구가 어디로(어느 기계, 어느 cloud) 옮기는지, 암호화되는지. 그다음 폴더를 만들고 `lophn settings set folder.destinations '{…}'`(있는 이름을 지우지 않게 먼저 get)를 부르면 사람에게 이름과 전체 경로가 보이는 승인 카드가 뜬다. 바꾸기와 지우기도 같다. 사람이 없는 일(job, unattended run)에서는 요청할 수 없다. data root(`~/.lophn`)를 그 폴더 안에 두거나 그 폴더를 data root 안에 두지 않는다. data root 자체를 공유 저장소에 두지 않는다. 다른 기계에서도 같은 이름으로 둔다(그 기계의 사람과 agent가).
   - **Move the folder with a tool**: lophn은 폴더에 쓰고 읽기만 한다. 고르는 순서: 사람의 기계끼리(같은 LAN이나 서로 닿는 기계)는 Syncthing, cloud는 rclone과 `crypt` remote(Google Drive도 rclone의 remote로), 암호화하지 않는 cloud 폴더(Google Drive for desktop 등)는 기본으로 쓰지 않는다: 쓰려면 먼저 "이 폴더의 file은 암호화되지 않은 채 Google에 올라가 Google이 읽을 수 있다"를 쉬운 말로 말하고, 사람이 그것을 알고 받아들일 때만 쓴다. cloud에 암호화 없이 올리지 않는다(`crypt`의 password는 사람이 정하고 기계마다 사람이 넣는다. chat으로 받지 않는다). 설치, login, 기기 pairing(Syncthing device id 승인)은 사람이 그 기계에서 한다: agent는 명령을 준비하고 무엇을 누를지 말한다. 스스로 맞추지 않는 도구(rclone)는 OS 예약(systemd user timer, launchd agent, Windows Task Scheduler)으로 몇 분마다 돌린다. rclone은 `bisync` 대신 두 명령으로 둔다: 자기 하위 폴더 `machines/<이 기계 id>/`를 `rclone sync`로 올리고(compaction이 지운 것도 지워진다), `machines/`의 나머지를 `rclone copy`로 내려받는다(이 기계 id는 `machine.environment`의 `this_machine.id`. lophn은 자기 하위 폴더에만 쓰고 남의 것을 지우지 않는다). 이 기계에서 해 본 뒤 `lophn machine environment`로 다른 기계가 보이는지 확인한다.
   - **Bring an app to another machine**: 그 기계에서 `lophn machine environment`의 `available`, `lophn app take-in <app>`, `lophn release activate <release>`, 사람이 그 기계에서 동의한다(grant와 secret은 다시 묻는다, 옮기지 않는다). 그 기계의 lophn이 낮으면 먼저 올리라고 말한다.
   - **Tell the person**: 무엇이 어디로 가는지, 암호화되는지, 실시간이 아니라 도구가 옮기는 만큼 늦다, 폰에서 쓴 것은 컴퓨터 한 대가 켜져 있어야 퍼진다, 기계마다 release가 같아야 맞고 다르면 data는 잃지 않고 기다린다, agent 정의·skill·설정·key는 기계마다 따로다.
   - **Away too long**: `apps[].away`나 "was away … too long" 알림이 있으면 그 기계가 90일 넘게 다른 기계와 맞추지 못한 것이다. held 변경을 `lophn app sync-held <app> --action list`로 보이고, 사람과 하나씩 정한다: 지금도 맞으면 `apply`(이 기계의 새 변경으로 다시 나간다), 아니면 `discard`. 스스로 고르지 않는다. 오래 쓰지 않을 기계는 사람이 그 기계를 목록에서 지울 수 있다(`lophn machine forget`, 사람의 터미널).
   - **Read the state**: `machine.environment`의 `error.code`마다 할 일 한 줄(`destination_missing`: 도구가 안 돌거나 폴더가 옮겨짐, `foreign_writer`: 같은 data root를 복사한 두 기계일 수 있다 사람에게 알린다, `invalid_file`·`waiting_for`: 도구가 아직 다 옮기지 않음, `clock_ahead`: `details.machine_name`의 시계를 맞추라고(어느 기계인지 말한다), `held`: 기계마다 같은 release로 올린다, `newer_format`: 이 기계의 lophn을 올린다).
2. `SKILL.md`: bundled file을 가리키는 단락에 "when the app's data must reach the person's other computers (`sync_to`), first read `folder-sync.md`" 꼴의 구절 하나. 한도를 넘으면 기존 문장을 줄이지 말고 보고한다.
3. `AGENTS.md.tmpl`: `runs_on` 단락 뒤에 `sync_to` 두 줄(무엇, 없으면 이 기계에만, 쓰기 전에 `folder-sync.md`).
4. 메모의 `## Instruction diff`: 이 task와 `folder-decl`의 지침 변경(`guide.md`의 `sync_to` 단락, `SKILL.md`, `AGENTS.md.tmpl`)을 git diff로 뽑아 바뀐 hunk만. 위에 할 일: 앱 `AGENTS.md`의 lophn 관리 부분을 새 줄로 맞춘다.

## 끝남

- `npm run check`가 통과한다(skill 크기 검사, `node tools/check-sdk-notes.ts`, flows).
- 위험 test: 없음(지침).
- 남지 않음: `grep -rn "rclone\|Syncthing\|Google Drive" packages --include=*.ts`가 0줄이다(도구 이름은 지침 글에만).
- flows catalog: 내장 skill의 file을 더한 것이 catalog에 걸리면 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `folder-sync.md`와 `SKILL.md`의 bytes, 지침에 쓴 명령 목록(실제 CLI 이름과 맞는지 `lophn help`로 본 결과).
