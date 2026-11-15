# mobile-preview-phone

앱 agent가 자기가 쓴 폰 화면을 desktop preview로 확인한다: `lophn tab open --preview <app> --screen <key>`가 그 폰 화면을 `phone` 자리로, 사람의 기준 폰 크기·DPR·OS로 에뮬레이션한 틀에 연다. 화면은 build가 만든 react-native-web 진입(`index.html`, `preview.js`)이고 `lophnApp`은 desktop 앱 view와 같은 preload가 준다. 이 task가 끝나면 kit·hook·build·binding이 한 줄로 이어진다: 진짜 kit으로 쓴 폰 화면이 desktop preview에서 그려지고 operation이 불리는 것까지 확인한다.

- 단위: phone-screen (wave 6)
- 선행: mobile-build-phone, mobile-shell-views, mobile-sdk-kit, mobile-sdk-phone-hooks, mobile-phone-target. **`mobile-coding-agents` 계획의 `mobile-host-link`가 main에 먼저 올라간 뒤에 띄운다**(아래 소유의 host queue file을 그 task가 소유한다. 그 계획의 `mobile-host-link-cleanup`(그 계획 wave 5)도 같은 file을 고치므로 둘 중 늦은 쪽이 rebase한다). `mobile-app` 계획이 land된 뒤여야 kit part가 있다
- 소유(이 task만 고친다):
  - `packages/cli/commands/tab.ts`
  - `packages/cli/commands/tab_test.ts`
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/core/host-queue`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/shell/renderer/workspace/app-preview-tab.tsx`
  - `packages/shell/renderer/workspace/kinds/app-preview.tsx`
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/apps/source.ts`
  - `packages/shell/renderer/apps/core-source.ts`
  - `packages/shell/renderer/apps/testdata/fake-apps.ts`
  - `packages/design/i18n/catalog/app-space.ts`(새 문구 key만. file 이름은 `app-space.empty.no-preview` 같은 기존 key가 있는 catalog를 `grep`으로 찾아 맞춘다)
- 읽을 것:
  - 본보기: 지금의 `--device` 길 — `packages/cli/commands/tab.ts`(`--preview`, `--device` 입력과 설명), `packages/protocol/lophn-agent/host-queue.ts`의 `preview` target(`{app, device}`), `packages/core/main/daemon/wiring/host-queue.ts`의 `open` handler(`deviceNames`, `preview`, `conflict`), `packages/core/host-queue/queue.ts`(탭이 이미 있으면 기기만 다시 알린다), `packages/shell/renderer/workspace/use-surface-requests.ts:195-245`(이미 열린 preview 탭에 기기를 준다), `app-preview-tab.tsx`(기기 emulation, `EmbeddedView mode="preview"`)와 `kinds/app-preview.tsx`(`fields.device`), `packages/shell/renderer/apps/core-source.ts`의 `entryScreen`
  - 기준 폰: `packages/core/config/shell-settings.ts`의 `devicesSetting`(pairing한 폰의 항목은 `device`(기기 id)를 단다), `packages/core/remote/devices.ts`(table `devices`, `is_primary`. 이 task는 `core/remote`를 고치지 않는다. 기준 기기의 이름을 읽기만 한다), `packages/core/apps/phone/target.ts`(기준 기기를 읽는 같은 질의)
  - view binding: `packages/protocol/apps/views.ts`(`app_views/open`: 선언을 읽을 수 있으면 `place`가 그 화면의 `places`에 들어야 한다), `packages/shell/main/app-frame/registry.ts`(`mobile-shell-views`가 core `app_views/*`로 바꿨다)
  - build 결과: `mobile-build-phone`의 보고(preview 진입의 배치)와 `ui-build/phone/`
  - architecture: `project-docs/architecture/browser-tab.md`("기기 emulation", host queue의 browser 호출), `workspace-layout.md`("agent가 연 탭")
  - 사람이 폰 확인을 하는 것은 단계 10이다: preview는 web 에뮬레이션이다(입력·키보드·scroll·글꼴이 폰과 다르다). 이 한계를 `lophn tab open`의 설명에 쓴다
- 계약:
  - 쓰는 것: 위 binding과 build 결과, `shell.devices`
  - 내놓는 것: `tabs/open`의 preview target이 `{app, device, screen}`(`screen`은 선택, 없으면 지금처럼 앱의 첫 `tab` 화면)이 된다. CLI `lophn tab open --preview <app> --screen <key> [--device <name>]`. 규칙:
    - `--screen`은 `--preview`와만 쓴다(`invalid_input`). 그 화면이 preview의 release 선언에 없으면 `not_found`("no screen named …"과 있는 화면 목록).
    - 화면의 `places`가 `["phone"]`이면 `phone` 자리로 연다. `--device`가 없으면 core가 기준 기기(`devices`의 primary)에 대응하는 `shell.devices` 항목(`device` id가 같은 것)의 이름을 채운다. 기준 기기가 없고 `--device`도 없으면 `conflict`("no phone is registered: pair a phone or register a device in Settings > Browser, then pass --device")다(넓은 틀에 폰 화면을 그려 잘못 믿게 하지 않는다). 기기 id는 agent에게 새지 않고 이름만 쓴다.
    - 화면이 폰 화면이 아니면(`tab` 등) 지금과 같다(기기 선택은 그대로 선택). 이미 열린 preview 탭에 `--screen`이나 `--device`를 주면 같은 탭이 그 화면과 기기로 바뀐다(`use-surface-requests`의 기존 길과 같다).

## 할 일

1. `host-queue.ts`의 preview target에 `screen: z.string().min(1).max(64).nullable().default(null)`을 더한다. `tab.ts`에 `--screen <key>`를 더하고 `--preview`와만 쓰게 한다(`--device`가 `--preview`를 요구하는 기존 검사 옆). 명령 설명(agent가 읽는 글)에 위 규칙과 "web 에뮬레이션이다, 마지막 확인은 사람이 폰에서 한다"를 쓴다.
2. core의 `open` handler(`wiring/host-queue.ts`): `screen`이 있으면 preview의 release 선언(`apps/tools`의 읽기와 같은 값)에서 그 화면을 찾고(`not_found`), 폰 화면이면 위 기기 채우기와 `conflict`를 한다. 기준 기기 이름은 handler가 받는 새 dep(`primaryDeviceName(): string | null`)로 얻는다(wiring이 `devices`와 `shell.devices`로 만든다). 이름을 채운 target을 queue에 넣는다. 이미 열린 탭에 `screen`이 오면 `device`처럼 탭에 다시 알린다(`queue.ts`).
3. renderer: `use-surface-requests.ts`가 `screen`을 탭의 `fields.screen`으로 넘기고(이미 열린 탭이면 `screen_at`으로 다시 알린다), `kinds/app-preview.tsx`와 `app-preview-tab.tsx`가 그 화면과 자리를 쓴다: `source.entryScreen`을 `source.previewScreen(app, release, screen?)`(`{key, place}`)으로 넓힌다(화면이 지정되지 않으면 지금의 첫 `tab` 화면, 지정됐으면 그 화면과 그 `places`에서 고른 자리: `phone`이 있으면 `phone`, 아니면 `tab`이 있으면 `tab`, 아니면 첫 자리). `EmbeddedView`의 `place`에 그 자리를 준다. `app-preview-tab`이 폰 화면을 열 때 `fields.device`가 비어 있으면(사람이 [Preview]로 연 탭) 기기 선택은 지금처럼 사람이 한다. 화면을 못 읽으면 지금의 "screen not ready" 문구다.
4. 손으로 end-to-end를 확인한다(`npm run dev`, `.dev-data/` 안): (a) 개발 core에 사람이 아닌 가짜 pairing으로 기준 기기를 하나 만든다(`tools/remote-dev.ts`의 길이나 desktop Settings의 기기 등록을 쓴다. 실제 폰과 `~/.lophn`을 쓰지 않는다), (b) 앱 하나를 `lophn app create`로 만들고 그 앱 workspace에서 폰 화면 하나(kit의 `Screen`, `List`, `OperationButton`으로 operation 하나를 부르는 것)를 쓰고 `lophn release prepare`와 `lophn preview start`를 한다(실제 model provider를 부르지 않는다. 화면 source는 손으로 쓴다), (c) `lophn tab open --preview <app> --screen <key>`로 연다, (d) `lophn browser snapshot`, `screenshot`, `act`로 그려진 DOM을 읽고 단추를 눌러 operation이 불리고 화면이 바뀌는지 본다. 되는 것과 안 되는 것(kit이 react-native-web에서 어긋나는 곳, 글꼴, 키보드)을 그대로 보고한다. 안 되는 것 가운데 이 task의 소유 밖(build의 shim, kit)은 고치지 말고 어느 file의 무엇인지 적는다.
5. flows catalog: 바뀐 CLI 입력과 tabs/open의 새 갈래, 새 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `project-docs/architecture/browser-tab.md`의 "기기 emulation"과 host queue의 browser 호출 절에 `--screen`과 폰 화면을 한 문단으로 더한다(이 task가 고친다. 소유 목록에 없는 file이지만 이 문서 한 곳만 허락한다).

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: "`tabs/open`의 `--screen`은 agent가 자기 앱 workspace의 preview만 연다는 기존 규칙을 그대로 지키고(남의 앱은 `not_found`), 폰 화면에 기준 기기도 `--device`도 없으면 열지 않고 `conflict`를 낸다"(기존 `host-queue` test의 표에 case를 더한다)
- 남지 않음: `grep -rn "entryScreen" packages tools tests`가 `previewScreen`으로 넓힌 뒤 쓰는 곳만 남는다(이름을 바꿨으면 0줄).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 4번 end-to-end의 명령과 결과(`browser snapshot`의 앞부분과 screenshot 파일 경로 `.dev-data/mobile-preview-phone/shots/`), kit이 react-native-web에서 어긋난 곳, 등록할 것·넘길 줄.
