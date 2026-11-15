# mobile-local-guidance

앱 agent가 폰에서 도는 앱을 지을 줄 알게 지침을 맞춘다: `design-app` skill에 "Apps that run on the phone" 절, 앱 template의 `AGENTS.md.tmpl`, app agent prompt의 한두 줄, declaration guide의 `runs_on` 항목을 한 지침으로 맞추고, 이번 declaration 판 메모의 `## Instruction diff`. 지침이 실제 동작(앞 task들이 지은 것)과 같아야 하므로 마지막에 한다. 지침에는 도구와 SDK가 하는 일만 쓰고 계획·task 이름과 lophn 저장소 path를 쓰지 않는다.

- 단위: sdk (wave 7)
- 선행: mobile-local-decl, mobile-local-prepare, mobile-local-sync-phone, mobile-local-sdk. 같은 file을 고치는 `mobile-user-apps`의 `mobile-agent-guidance`(중간 land 전에 main에 있다)와 `mobile-widgets`의 `mobile-widgets-guidance`가 running이면 끝난 뒤에 띄우고, main에 있는 것 위에 쓴다
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`
  - `packages/core/agent-workspaces/prompts/app.md`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`(주석만)
  - `packages/sdk/declaration/guide.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/declaration-4.8.0.md`(`## Instruction diff`만. 이 판은 계획 끝 land 전이라 아직 어느 앱에도 가지 않았다. `mobile-local-decl`이 다른 판으로 썼으면 그 file)
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(Instruction diff는 git으로 뽑는다. 이미 낸 판의 메모는 고치지 않는다: cap-store 2.0.0·cap-tool 2.2.0·cap-problem 1.1.0은 중간 land로 이미 나갔다)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(f)(폰에서 `unavailable`인 것), 2(g)(지침에 쓸 것)
  - 계획 `README.md` "정한 것"
  - 실제 동작의 근거(앞 task의 보고): `mobile-local-decl`(두 검사와 거절 문장), `mobile-local-prepare`(준비 실패 문장 넷), `mobile-local-sdk`(cap-store guide: `StoreDb`, `newId`, 인자 없는 `migrate()`, `transaction`), `mobile-local-runtime-phone`(폰에서 read·write는 늘 local, `unavailable`이 화면에 오는 모양), `mobile-local-sync-phone`(폰에 보이는 상태, standalone data는 지우지 않는다, release가 바뀔 때 지운 column의 안 보낸 변경은 버려진다)
  - 지금 지침: `design-app/SKILL.md`(단계 6의 "Phone screens", `mobile-widgets`의 "Widgets"가 있으면 그 옆), template `AGENTS.md.tmpl`의 lophn 관리 부분, `prompts/app.md`, `packages/sdk/declaration/guide.md`의 `runs_on` 항목(`mobile-local-decl`이 최소로 썼다), `packages/sdk/cap-store/guide.md`
- 계약:
  - 쓰는 것: 위 동작. 지침이 동작과 다르면 지침을 고치고, 동작이 틀려 보이면 보고한다(고치지 않는다)
  - 내놓는 것: 아래 지침과 template 변경. 기본 template의 `runs_on`은 없다(컴퓨터에서 도는 앱이 기본이다)

## 할 일

1. `design-app/SKILL.md`에 "Apps that run on the phone" 절: (a) 고르기: 컴퓨터의 data를 실시간으로 보거나 컴퓨터 기능(network, secret, 알림, agent, command, job)이 핵심이면 `["computer"]`, 컴퓨터가 꺼져도 폰에서 읽고 써야 하고 desktop에서도 쓰면 `["computer", "phone"]`, 폰에서만 쓰고 backup이 없어도 되면 `["phone"]`(data가 폰에만 있고 lophn agent가 읽을 수 없고 rewind가 없다는 것을 사람에게 말한다). (b) data: id는 `newId()`, 정수·autoincrement PK와 trigger 금지, sync 앱의 table·column 이름을 바꾸지 않는다(이름으로 맞춘다. 바꾸면 폰의 안 보낸 변경이 버려진다), `BEGIN`/`COMMIT`을 직접 쓰지 않고 `store.transaction`. (c) backend: `node:*`, `@lophn/cap-fs`, `@lophn/flow`를 쓰지 않는다. write operation은 컴퓨터 전용 기능에 기대지 않고 그것은 `external` operation에 둔다. read operation은 쓰지 않는다. (d) 화면: external은 컴퓨터가 없으면 `unavailable`이니 화면이 그것을 다룬다. 폰에서 한 write의 앱 event는 전달되지 않는다. 같은 칸을 두 곳에서 고치면 나중 것이 말없이 이긴다. (e) 확인: 준비가 막는 것(실패 문장)과 desktop preview는 backend를 컴퓨터에서 돌린다는 한계.
2. template `AGENTS.md.tmpl`의 lophn 관리 부분에 `runs_on` 한 줄과 위 절을 가리키는 줄. `lophn.ts.tmpl`에 `runs_on`을 주석 예로(값은 넣지 않는다). `prompts/app.md`에 폰에서 도는 앱을 지을 때 위 절을 읽으라는 한 줄.
3. `packages/sdk/declaration/guide.md`의 `runs_on` 항목을 위 절과 맞춘다(짧게, 자세한 것은 skill로).
4. declaration 메모의 `## Instruction diff`: 위 file들의 git diff(지침 hunk만)와 그 위에 할 일(앱의 `AGENTS.md` lophn 관리 부분을 새 줄로 맞춘다, 폰에서 도는 앱을 지을 때 위 규칙을 따른다).

## 끝남

- `npm run check`가 통과한다. `node tools/check-sdk-notes.ts`가 통과한다. template을 쓰는 test가 통과한다.
- 위험 test: 없음(지침).
- 지침 글에 계획·task 이름, lophn 저장소 path가 없다: `grep -n "mobile-local\|packages/" packages/core/agent-workspaces/skills/design-app/SKILL.md packages/sdk/declaration/guide.md`에 이 task가 더한 줄이 없다.
- flows catalog: 바뀐 줄이 있으면 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 더한 절의 요약, 동작과 지침이 어긋나 보인 곳.

## lead가 더함 (`mobile-sync-core` 결과, 2026-11-15)

- 지침에 더할 것: 폰에서 도는 앱의 table은 PK 밖의 UNIQUE와 CHECK를 쓰지 못한다(규칙은 handler에서 지키거나 그 값을 PK에 넣는다). column 이름 바꾸기는 지우고 새로 만든 것으로 취급되어 보내지 않은 폰의 변경을 잃는다. PK 값을 바꾸는 migration은 보내지 않은 폰의 변경을 잃는다. 같은 값으로 고치는 write와 없는 줄 지우기도 clock을 움직인다(문제는 아니고 알아 둘 것).

## lead가 더함 (`mobile-sync-runtime` 결과, 2026-11-15)

- 지침에 더할 것: sync 앱은 module을 load할 때 write하지 않는다(초기 data는 migration이나 첫 호출에서 넣는다). handler 안에서 `BEGIN`·`COMMIT`을 직접 쓰지 않는다(SDK의 `transaction()`을 쓴다). 변경 하나가 changeset 한도를 넘으면 폰이 snapshot을 다시 받는다(큰 일괄 변경은 나눠서 한다).
