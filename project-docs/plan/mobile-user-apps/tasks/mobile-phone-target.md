# mobile-phone-target

lophn agent가 사람의 기준 폰(pairing으로 등록한 기기 가운데 `primary`)의 이름, OS, 크기, DPR을 읽는다. read route `apps/phone_target`과 CLI 명령 `lophn app phone-target`을 낸다. agent는 폰 화면을 이 크기에 맞춰 그리고(반응형을 만들지 않는다) 기기가 없으면 사람에게 pairing을 청한다.

- 단위: app-place (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/phone.ts`(새 file)
  - `packages/core/apps/phone`(새 폴더: `target.ts`, `target_test.ts`)
  - `packages/cli/commands/app.ts`
  - `packages/cli/commands/app_test.ts`
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다):
  - `packages/protocol/apps/mod.ts`(`export * from "./phone.ts"`), `packages/protocol/apps/registry.ts`(route를 목록에)
  - `packages/core/apps/register.ts`(`reads` 목록에 handler 한 줄)
  - `project-docs/flows/`(`areas/cli.yaml`에 `cli:app.phone_target`, route의 area file(check가 알려 준다), `areas.yaml`에 `packages/protocol/apps/phone.ts`가 필요하면)
- 읽을 것:
  - 본보기(같은 모양의 앱 read와 CLI 명령): `packages/protocol/apps/runtime.ts`의 `appRuntime`(`defineRead`, `reads`, 오류 목록), `packages/core/apps/runtime/reads.ts`의 `createRuntimeReads`(snapshot을 읽는 `ReadDefinition`)와 그것이 `packages/core/apps/register.ts`에 오른 곳, `packages/cli/commands/app.ts`의 `sdkStatus`(`defineCommand`, `routes`, `workspaces`, `ctx.core.read`)
  - 기기 표: `packages/core/remote/devices.ts`(table `devices`, 칸 `name os width height dpr is_primary`, 새로 pairing하면 그 기기가 `is_primary = 1`이 된다), `packages/protocol/remote/routes.ts`의 `devicesList`(`reads: ["remote_devices"]`. 이 이름이 바뀔 때 `StateChanged`가 나온다), `packages/protocol/remote/frames.ts`의 `remoteDeviceSchema`(width 200~2000, height 200~3000, dpr 1~4, CSS px)
  - architecture: `project-docs/architecture/remote.md`(기기 등록, `shell.devices`), `browser-tab.md`(기기 emulation)
  - roadmap: `project-docs/products/roadmap/mobile.md`의 "기기 정보가 가는 곳", "등록한 기기에 맞춘다"
- 계약:
  - 쓰는 것: `devices` 표를 읽는다(읽기만). 이 task는 `packages/core/remote`와 `packages/protocol/remote`를 고치지 않는다(`phone-app`과 `mobile-push`가 소유한다)
  - 내놓는 것:
    - route `apps/phone_target`(`name: "app.phone_target"`, read, actors `user`·`agent`, 오류 `invalid_input`·`forbidden`·`unavailable`): 입력 `{}`(strict), 출력 `{device: {name: string, os: "ios"|"android", width: number, height: number, dpr: number} | null}`에 read 공통 칸(`withReadCommon`). 기준 기기가 없으면 `device: null`. 기기 id와 공개 key는 내지 않는다
    - CLI `lophn app phone-target`(command `app.phone_target`, effect read, workspaces `home`·`app`)

## 할 일

1. `packages/protocol/apps/phone.ts`에 위 route를 정의한다(`reads: ["remote_devices"]`). `mod.ts`와 `registry.ts`에 한 줄씩 더한다.
2. `packages/core/apps/phone/target.ts`에 `ReadDefinition`을 짓는다: `select name, os, width, height, dpr from devices where is_primary = 1`을 snapshot의 sql로 읽는다. 앱 module이 remote module의 표를 읽는 것이므로 그 사실과 이유(agent가 기기 key를 보지 못하게 좁은 읽기를 앱 쪽에 둔다)를 한 줄 주석으로 남긴다. `register.ts`의 `reads` 목록에 올린다. 만약 `tools/check-deps.ts`나 `tools/check-reads.ts`가 이 읽기를 거절하면 만들지 말고 어느 규칙이 거절했는지 보고한다.
3. `packages/cli/commands/app.ts`에 `phoneTarget` command를 더한다(`APP_COMMANDS`에도). `description`은 agent가 읽고 따르게 쓴다: 이 값이 폰 화면을 그릴 기준 기기다, `width`·`height`는 폰 화면 전체의 CSS px이라 lophn의 top bar 아래 쓸 수 있는 높이는 더 작다, `dpr`은 pixel 비율, `device`가 null이면 기기가 없으니 폰 화면을 그리기 전에 사람에게 폰을 pairing하라고 말한다, 사람이 폰을 바꾸면(새로 pairing하면 기준이 바뀐다) 옛 크기로 그린 폰 화면은 다시 그려야 한다. `run`은 read한 값을 `content`로 내고 summary는 한 줄(`<name> <os> <width>x<height> @<dpr>x` 또는 "no phone is registered")이다.
4. 단위 test 하나(`target_test.ts`)와 `app_test.ts`에 명령이 목록에 오른다는 확인이 이미 있으면 그 모양대로 한 줄만 더한다.
5. flows catalog(`flows` skill): 새 route와 CLI의 입구와 outcome(`device: null` 갈래 포함), 새 test file의 줄.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: "`apps/phone_target`의 출력은 `name, os, width, height, dpr`만 싣고 기기 id와 공개 key를 싣지 않으며, 기준 기기가 없으면 `device`가 null이다"(secret 경계라 둔다. 그 밖의 test는 더하지 않는다)
- 남지 않음: 없음(더하기뿐).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: route와 CLI 출력 예 하나씩(기기 있음과 없음), 등록할 것·넘길 줄, 2번에서 규칙이 거절했으면 그 이유.
