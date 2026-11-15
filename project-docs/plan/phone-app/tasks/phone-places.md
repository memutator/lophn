# phone-places

project workspace 화면(Sessions, Workflows와 내 차례, Files와 문서 읽기)과 앱 workspace 화면을 짓는다.

- 단위: mobile-app (wave 3)
- 선행: phone-frame, phone-routes
- 소유(이 task만 고친다):
  - `mobile/src/screens/workspace`
  - `mobile/src/data/places.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/workspace.tsx` 전부, `apps.tsx`의 `AppMenu`와 `Activity`. 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/{6-project-workspace,3-apps}.png`
  - route: `phone-routes`의 보고(계획 status와 lead가 알려 주는 표), `packages/protocol/remote/allowlist.ts`
  - desktop의 같은 화면: workflow 탭과 file 탐색기의 source(`packages/shell/renderer/`에서 route 이름으로 찾는다), `project-docs/architecture/workflow.md`
  - kit과 뼈대: `packages/design/native/mod.ts`, `mobile/src/app/nav.ts`, `mobile/src/parts`, `mobile/src/data/mod.ts`
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에", `mobile/README.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `mobile/src/data/mod.ts`. kit에 없는 조각이 필요하면 자기 영역 폴더에 두고 보고한다(kit은 고치지 않는다). data에 없는 읽기가 필요하면 자기 소유의 data file에 더한다.
  - 내놓는 것: 자기 영역의 `index.tsx`가 export하는 화면

## 할 일

1. project workspace: 위 줄(sidebar 단추, 이름, +는 새 session)과 탭 Sessions·Workflows·Files·Jobs. Sessions는 worktree 묶음과 Recent, 맨 아래 입력 칸으로 이 project의 새 session을 연다. Jobs 탭은 `phone-ops`의 화면이 생기기 전이라 이 project의 job 목록을 읽기만 보인다.
2. Workflows: 정의마다 Start와 instance 목록(내 차례가 노랗다). instance 화면: 제목, 상태, 내 차례면 Open the conversation이 맨 위, step 줄, Open the report, Stop this run.
3. Files: 폴더를 훑고 글 file은 읽기 화면(Markdown은 reading 모양, 그 밖의 글은 mono)으로 연다. 아래 입력 칸은 이 file을 가리키는 새 session을 연다. 읽기만이다. route가 없는 종류는 '컴퓨터에서 연다'고 보인다.
4. 앱 workspace: 앱의 폰 화면을 띄우는 것은 다음 계획이다. 지금은 위 줄(표식과 이름)과 탭 Sessions·Activity, 그리고 release 한 줄, 맨 아래 입력 칸(`Ask lophn to change this app`: 이 앱 workspace의 새 session)을 둔다. Activity는 wireframe `Activity`처럼 실행과 실패를 보인다.

마지막으로 emulator(port 5572, Metro 8212)에 lead가 지어 둔 dev build `/tmp/lophn-phone-app-x86_64.apk`를 깔고(native module을 더하지 않는다) sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/phone-places/shots/`에 둔다(light 전부, dark 둘). 개발 core(`tools/remote-dev.ts`)에 pairing해 실제 data로 한 번씩 동작을 확인하고, 못 본 것은 "확인 못 함"으로 적는다.

## 끝남

- `cd mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것.
