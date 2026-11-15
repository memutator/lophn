# mobile-web-removal

컴퓨터가 폰에 web 화면을 내려주던 길을 core, renderer, protocol, tools에서 지운다. 폰은 이제 자기 화면을 갖는다.

- 단위: remote-web (wave 3)
- 선행: mobile-frame
- 소유(이 task만 고친다):
  - `packages/shell/renderer/remote`
  - `packages/core/remote/ui-bundle.ts`
  - `packages/core/remote/mod.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/main/daemon/wiring/remote_test.ts`
  - `packages/protocol/remote/routes.ts`
  - `packages/protocol/remote/mod.ts`
  - `packages/protocol/remote/allowlist.ts`
  - `tools/remote-dev.ts`
  - `tools/package/main.ts`
  - `tools/wireframes/pages/screens/remote.tsx`
  - `packages/shell/renderer/build.ts`
  - `packages/design/i18n/catalog/remote.ts`
- 읽을 것:
  - 지울 목록: `/home/pyosechang/projects/lophn/reports/phone-native-ui/lophn-inventory.md`의 B 끝(이 길만을 위해 있는 file·route·module). `packages/mobile/` 쪽은 `mobile-frame`이 이미 지웠다
  - architecture: `project-docs/architecture/remote.md`(폰 껍데기 model과 지키는 것 6~9. lead가 계획 끝에 고친다)
  - `tools/remote-dev.ts`는 폰 개발에 계속 쓴다: 개발 core를 remote로 띄우는 부분은 남기고 web 화면 build와 serve만 뺀다
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `remote_ui/manifest`, `remote_ui/file` route와 web bundle이 없는 core

## 할 일

1. route `remote_ui/manifest`, `remote_ui/file`과 그 handler(`packages/core/remote/ui-bundle.ts`), wiring, allowlist의 bundle 묶음, protocol export를 지운다. method 문자열로도 grep한다.
2. `packages/shell/renderer/remote/`(폰 web 화면)와 그 build 입구(`packages/shell/renderer/build.ts`의 remote entry, `tools/package/main.ts`가 싣는 `dist/remote`)를 지운다. desktop 대화 화면의 `phone` 갈래(`AgentView`의 phone flag와 그것만 쓰던 문구 key `remote.*`)는 쓰는 곳이 없어지면 지우고, 남는 곳이 있으면 보고한다.
3. 옛 폰 web 화면만 쓰던 문구 key(`packages/design/i18n/catalog/remote.ts`의 `remote.*`)를 지운다. 쓰는 곳이 남은 key는 남기고 보고한다(file을 통째로 지우게 되면 `en.ts`의 등록 줄은 lead가 뺀다).
4. gallery의 `Phone remote` 영역(`tools/wireframes/pages/screens/remote.tsx`)을 지운다. `pages/index.ts`의 등록 줄은 lead가 뺀다(보고의 "등록할 것").
4. 지운 route와 test를 가리키는 flows catalog 줄은 lead가 고친다(보고에 목록).

## 끝남

- `npm run check:full`, `node packages/shell/renderer/build.ts`, `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: 없음(지운 것의 test는 같이 지운다. 폰 자격의 route 목록 test는 남는다)
- 남지 않음: `grep -rn "remote_ui\|ui-bundle\|renderer/remote" packages tools tests --include=*.ts --include=*.tsx --include=*.json`이 0줄이다.

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 지운 file 목록, 등록할 것(`tools/wireframes/pages/index.ts`, flows), desktop에 남긴 `phone` 갈래가 있으면 그 자리.
