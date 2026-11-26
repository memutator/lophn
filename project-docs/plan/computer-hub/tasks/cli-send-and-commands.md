# cli-send-and-commands

- 단위: CLI commands (wave 2)
- 선행: a2a-slug-and-errors, scheduler-and-hub-relay
- 목표: `lophn send <path...> --on <computer> [--note]`, `lophn call send --attach`, `lophn handoff write --attach`, `lophn app take-in <slug|app_id>`, `lophn settings export|staged|apply|dismiss`를 구현하고, `lophn remote`의 제어 문구를 `control` 기준으로 맞춘다.
- 소유:
  - `packages/cli/commands/`
  - `packages/cli/`
- 참조:
  - `packages/protocol/folder/transfers.ts`
  - `packages/protocol/folder/settings-export.ts`
  - `packages/protocol/folder/take-in.ts`
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/lophn-agent/mail.ts`
  - `packages/protocol/lophn-agent/handoff.ts`
  - `packages/cli/commands/mod.ts`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **`lophn send` 명령 (`packages/cli/commands/send.ts` 신설 및 `mod.ts` 등록)**:
   - `lophn send <path...> --on <computer> [--note <text>] [--json]`
   - `--on` 지정 컴퓨터(`transfers/send`)로 로컬 파일들을 보낸다. workspace: agent & CLI 둘 다 쓸 수 있게 `workspaces` 포함 여부 확인(agent shell 안에서는 workspace 상대 경로 resolve 지원).
   - 출력: transfer ID (`trf_...`), 파일 목록, 전달 상태(`delivered` / `held_at_hub` via `@Hub` / `queued`), 만료 시각 표시.
   - `lophn send status <trf_...>` / `lophn send list` (또는 `lophn send` subcommand로 조회/정리) 지원하면 편리하고 깔끔함.

2. **`--attach` 지원 (`call.ts`, `handoff.ts`)**:
   - `lophn call send ... --attach <path...>` (`packages/cli/commands/call.ts`): `--on <computer>`로 보낼 때 먼저 `transfers/send`로 첨부 파일을 올린 뒤 나온 `TransferAttachment`들을 `attachments`로 싣는다(로컬 call 시에도 필요 시 안내 또는 동일 전달).
   - `lophn handoff write ... --attach <path...>` (`packages/cli/commands/handoff.ts`): 동일하게 `transfers/send`로 project 다른 컴퓨터 앞 또는 handoff 첨부로 올린 뒤 `attachments`를 `handoff.write`에 넘긴다.

3. **`lophn app take-in <slug|app_id>` (`packages/cli/commands/app.ts`)**:
   - `app_` ID뿐 아니라 앱 `slug`를 받아도 `app.take_in` route로 넘겨 가져오게 한다.

4. **`lophn settings export|staged|apply|dismiss` (`packages/cli/commands/settings.ts`)**:
   - `lophn settings export <kind> <id...> --on <computer> [--project <prj>] [--note <text>]` (`settings_export/send`): `agent`, `skill`, `project_command`, `permission_rules`, `workflow` 내보내기.
   - `lophn settings staged` (`settings_export/staged`): 대기 중인 `stg_` 배치 목록 출력.
   - `lophn settings apply <stg_...> [--confirm-permissions] [--overwrite]` (`settings_export/apply`): `permission_rules`나 locked field가 포함되어 `requires_person_confirmation`이면 명확한 경고와 함께 `--confirm-permissions` 또는 GUI Settings › My computers에서 확인하도록 안내한다.
   - `lophn settings dismiss <stg_...>` (`settings_export/dismiss`).

5. **`lophn remote` 문구·상태 정리 (`packages/cli/commands/remote.ts`)**:
   - 터미널 입력 권한 토글 안내 문구를 "terminal input"에서 **computer control (`Allow controlling this computer`)** 개념에 맞게 정돈하고, `remote status` 출력에 hub listening 상태 및 ordered relays가 보이면 함께 출력한다.

6. **테스트**:
   - `packages/cli/commands/` 기존 단위 테스트 패턴(`*_test.ts`)으로 새 명령 argument 파싱·실행 테스트 추가.

## 완료 기준

- `node --test packages/cli/**/*_test.ts` 통과
- `node tools/flows.ts check` (새 `cli:` entries가 생기면 flow area `cli.yaml` 연동 필요 시 보고하거나 최소화; 참고: Wrap-up에서도 flows 검증함) 및 `npm run check` 통과
