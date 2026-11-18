# carry-cleanup

길이 셋 늘어난 뒤 남은 옛 글과 검사를 걷고, 바뀐 동작에 맞춰 flows, catalog, architecture 문서를 고친다. 폴더 꼴은 이제 이름 붙인 폴더만의 것이 아니고, 폰은 폴더 file을 나른다. 새 동작은 더하지 않는다. 이 계획이 남긴 한계는 이슈로 올릴 것을 보고에 적는다.

- 단위: carry (wave 4)
- 선행: carry-phone, carry-notify, carry-settings
- 소유(이 task만 고친다):
  - `packages/core/folder/`
  - `packages/core/remote/carry.ts`, `packages/core/remote/links.ts`
  - `packages/core/main/daemon/wiring/folder.ts`, `packages/core/main/daemon/wiring/remote.ts`
  - `project-docs/architecture/app-sync.md`, `project-docs/architecture/folder-sync.md`, `project-docs/architecture/event.md`, `project-docs/architecture/remote.md`, `project-docs/architecture/machine.md`, `project-docs/architecture/app-call.md`
  - `project-docs/flows/`
  - `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml`
- 읽을 것:
  - 계획 README 전부와 이 계획의 다른 brief 여섯(`project-docs/plan/carry-paths/tasks/`), 각 task의 보고(lead가 prompt에 붙인다: "정한 것", "넘길 줄", "알려진 미완 동작")
  - `.claude/skills/flows/SKILL.md`, `.claude/skills/issue/SKILL.md`("올릴지"), AGENTS.md "문서"(architecture는 code path를 적지 않는다)
  - 조사 `reports/multi-device/survey-n2-carry-paths.md` 3(지금 code가 품은 가정 A~H)
- 계약:
  - 쓰는 것: 이 계획이 고정한 모든 이름
  - 내놓는 것: 없음

시작 전에 다시 볼 것: `one-screen`이 main에 올라왔으면 `links.ts`의 구독과 `architecture/remote.md`의 "다른 기계 보기"가 바뀌었다. 같은 문서를 고치므로 main의 판 위에서 고친다.

## 할 일

1. 옛 글과 검사: `packages/core/folder/`와 두 wiring의 주석과 오류 글에서 "폴더는 바깥 도구가 옮긴다", "폰은 폴더를 쓰지 않는다", "기계는 자기 하위 폴더에만 쓴다"처럼 이제 `computers` 폴더(받는 자리가 다른 기계의 하위 폴더를 쓴다)와 맞지 않는 말을 고친다. 검사는 지우지 않는다(남의 writer 검사는 자기 하위 폴더에서 그대로 맞다). `links.ts`의 머리 주석(link가 명단과 화면의 call만 나른다)을 고친다. route나 칸 이름을 바꾸면 문자열로도 grep한다.
2. architecture(code path 없이, 바뀐 동작만):
   - `folder-sync.md`: carry-contract의 초안을 wave 2가 실제로 한 것에 맞춘다(지키는 것 1·6·7의 새 뜻, manifest, 받는 자리, 거울, 명단 file, event file, "Settings 화면이 없다" 열린 것 지우기). "열린 것"에 아래 "남는 한계"를 적는다.
   - `app-sync.md`: 폰과 컴퓨터의 `app_sync`는 그대로이고 기계 사이는 폴더 꼴이 link, 폰, 거울로 간다는 문단(목표와 비목표의 "relay가 맡아 두는 것"·"폰은 폴더를 쓰지 않는다" 결정 줄), 남는 한계(폰 화면이 있는 앱의 사본).
   - `event.md`: `across_machines` event는 file로 가서 도착한 기계에서 한 번 난다(비목표 "앱 event의 저장"과 지키는 것 31을 그 뜻으로), core event `data.changed`(지키는 것 33의 목록).
   - `remote.md`: link가 폴더 file을 주고받는다(넘기는 것이 사람의 화면뿐이 아니다), 기기 route 목록의 `carry/*`, 판 5, 명단이 폴더 file로도 퍼진다.
   - `machine.md`: 기계 id가 폴더 하위 폴더와 manifest의 이름이고, 명단 서명 key가 manifest에 서명한다(경계와 계약 한 줄).
   - `app-call.md`: 다른 기계에서 온 event의 caller `machine`.
3. flows(`flows` skill): link로 받기, 폰이 나르기, 거울, 명단 file, event file을 `system:` flow로 올리고(본보기 `system:folder-release-follow`, `app-release.yaml`), 이 계획이 더한 test file과 위험 test를 그 outcome에 잇는다. `node tools/flows.ts check`와 `node tools/flows.ts report`로 빈 곳을 본다.
4. catalog: module catalog에 새 file·폴더(`packages/protocol/remote/carry.ts`, `packages/core/folder/{replica,mirror,carry-routes,carry-status}.ts`, `packages/core/remote/carry.ts`, `packages/mobile/src/apps/carry/`)가 맞는 module에 들었는지, boundary `folder`·`remote-protocol`·`mobile`·`events` 설명이 새 동작과 맞는지 고친다.
5. 이슈로 올릴 것을 보고에 적는다(lead가 `issue` skill로 올린다. 이 task는 `project-docs/issues/`를 고치지 않는다):
   - 폰 화면이 있는 앱은 폰이 컴퓨터마다 사본을 따로 들고 같은 node로 clock을 찍는다. 폰의 변경은 그 컴퓨터에 들어간 뒤 컴퓨터들 사이로 퍼진다. 사본을 하나로 합치는 것은 이 계획이 하지 않았다(README "남는 한계").
   - 그 밖에 각 task의 "알려진 미완 동작" 가운데 고치지 않고 넘어가는 것.

남는 한계(문서의 "열린 것"에 적는다, 고치지 않는다):
- 사람의 폴더(거울)에는 각 기계가 자기 하위 폴더만 쓴다. 거울만 보는 기계는 다른 기계의 file을 그 기계가 직접 거울에 낸 것으로만 받고, link나 폰이 그 기계에 닿아야 나머지가 간다.
- `computers` 앱의 release와 data가 data root 안에 한 번 더 복사된다(그 폴더가 data root 안이다).
- 폰은 상한(256 MiB)보다 큰 file(큰 snapshot, 큰 release)을 나르지 못한다. 그런 것은 link나 거울로만 간다.

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음(글과 문서다. 지우려는 검사가 지키던 경계가 있으면 지우지 말고 보고한다).
- 남지 않음: `grep -rn "phone does not write the folder\|폰은 폴더를 쓰지 않는다" packages project-docs/architecture`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 이슈로 올릴 것: 위 5
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
