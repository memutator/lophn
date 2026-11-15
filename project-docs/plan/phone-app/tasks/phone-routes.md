# phone-routes

새 폰 화면(Jobs, Agents, project의 file·workflow, 검색, model 고르기, session 이름 바꾸기·보관, 새 session, 앱 workspace의 실행 기록)이 부를 route와 event를 폰 allowlist에 더한다.

- 단위: remote-routes (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/remote`
- 읽을 것:
  - architecture: `project-docs/architecture/remote.md`(지키는 것: 폰 자격의 route 목록), `approval.md`, `job.md`, `workflow.md`
  - 화면이 필요로 하는 것: `tools/wireframes/drafts/phone/{session,inbox,workspace,more,apps}.tsx`와 그 caption
  - desktop이 같은 화면에서 부르는 route: `packages/shell/main/desktop/core/allowlist.ts`(renderer가 부르는 목록), Jobs·Agents·workflow·file 화면의 source(`packages/shell/renderer/` 아래에서 route 이름으로 grep)
  - 조사: `/home/pyosechang/projects/lophn/reports/phone-native-ui/lophn-inventory.md`의 B(지금 allowlist 57개와 event 17종)
- 계약:
  - 쓰는 것: route 정의는 그대로 둔다(`packages/protocol/**`의 route를 새로 만들거나 모양을 바꾸지 않는다)
  - 내놓는 것: 폰이 부를 수 있는 route와 받는 event의 목록. 보고에 화면별 표로 적는다(wave 3의 화면 task가 그 표를 쓴다)

## 할 일

1. 아래 화면마다 desktop이 쓰는 route와 event를 찾아 표로 만든다: Agents 목록과 상세, Jobs 목록·상세·실행 기록·켜고 끄기·지금 돌리기, project workspace의 file 목록과 글 file 읽기, workflow 정의·instance 목록·instance 상세·시작·멈춤, 검색(session·file·job·agent. desktop이 화면에서 거르는 것이면 route가 없다고 적는다), model 목록과 session의 model·effort 바꾸기, session 이름 바꾸기·보관, workspace와 agent를 골라 새 session 열기, 앱 workspace의 실행 기록과 지금 release, 컴퓨터 화면에 session 띄우기(있으면).
2. 폰의 권한 기준으로 가른다: 보기, 말하기, 답하기, 켜고 끄기, 지금 돌리기, 새 session은 더한다. 만들기·고치기·지우기(agent, job, app, workflow 정의), secret, provider와 model 관리, 기기 pairing과 끊기, 설정 쓰기는 더하지 않는다. file은 읽기만이다.
3. 고른 것을 `packages/protocol/remote/allowlist.ts`에 지금 묶음 꼴대로 더한다. route가 입력으로 범위를 좁히는 장치(예: project 밖 path)가 core 쪽에 있는지 확인하고, 폰 자격에서 그 장치가 그대로 걸리는지 `packages/core/remote`에서 본다.
4. 지금 화면에 필요한 route가 core에 없으면 만들지 않고 보고에 "없는 것"으로 적는다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: "폰 자격은 목록에 없는 route를 부르지 못한다"가 새 목록에서도 통과하고, "secret·provider·기기 등록·agent와 job의 만들기·고치기·지우기 route는 폰 목록에 없다"를 이름으로 확인한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 화면별 route·event 표(더한 것, 이미 있던 것, 더하지 않은 것과 이유, core에 없는 것), flows catalog에서 lead가 고칠 것.
