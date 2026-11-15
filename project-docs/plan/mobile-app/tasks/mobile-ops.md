# mobile-ops

Jobs(목록, 상세)와 Agents(목록, 상세)를 wireframe대로 짓는다.

- 단위: mobile-app (wave 3)
- 선행: mobile-frame, mobile-routes
- 소유(이 task만 고친다):
  - `packages/mobile/src/screens/jobs`
  - `packages/mobile/src/screens/agents`
  - `packages/mobile/src/data/ops.ts`
  - `packages/design/i18n/catalog/mobile-ops.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/more.tsx`의 `Jobs`, `JobDetail`, `Agents`, `AgentDetail`과 caption. 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/7-jobs-and-agents.png`
  - route: `mobile-routes`의 보고, `packages/protocol/remote/allowlist.ts`
  - desktop의 같은 화면: Jobs 탭과 Agents 탭의 source(`packages/shell/renderer/`에서 route 이름으로 찾는다), `project-docs/architecture/job.md`
  - kit과 뼈대: `packages/design/native/mod.ts`, `packages/mobile/src/app/nav.ts`, `packages/mobile/src/parts`, `packages/mobile/src/data/mod.ts`
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에", `packages/mobile/README.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `useNav()`, `packages/mobile/src/data/mod.ts`. kit에 없는 조각이 필요하면 자기 영역 폴더에 두고 보고한다(kit은 고치지 않는다). data에 없는 읽기가 필요하면 자기 소유의 data file에 더한다.
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 자기 catalog file에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장). 지어낸 예시 data는 그대로 둔다.
  - 내놓는 것: 자기 영역의 `index.tsx`가 export하는 화면

## 할 일

1. Jobs: 이름, 언제, 무엇을 하는지, 마지막 결과, 오른쪽 스위치(켜고 끄기). 상세: fact 줄, 실행 기록. Start now는 놓친 차례가 걸려 있는 job에만 보인다(core에 아무 job이나 지금 돌리는 route가 없다. 놓친 차례는 `jobs/decide_hold`). 고치기와 지우기는 없고 '컴퓨터에서 한다'는 한 줄을 둔다.
2. Agents: lophn agent(얼굴, 이름, Built-in tag, 어디서 일하는지, model)와 coding agent 묶음. 상세: 설명, model, 쓸 수 있는 skill 수(MCP 수는 보이지 않는다), 최근 session, New session(그 agent로 새 session 화면을 연다). 고치기는 없다.
3. 컴퓨터가 offline이면 마지막으로 읽은 것을 흐리게 보이고 스위치와 단추를 잠근다.

마지막으로 emulator(port 5574, Metro 8214)에 lead가 지어 둔 dev build `/tmp/lophn-mobile-app-x86_64.apk`를 깔고(native module을 더하지 않는다) sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/mobile-ops/shots/`에 둔다(light 전부, dark 둘). 개발 core(`tools/remote-dev.ts`)에 pairing해 실제 data로 한 번씩 동작을 확인하고, 못 본 것은 "확인 못 함"으로 적는다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- 소유 밖 file을 고치지 않았다.

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것.
