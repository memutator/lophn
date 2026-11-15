# mobile-drive-contract

폰의 preview 화면을 다루는 계약을 고정한다: core가 폰 link로 묻는 kind 넷(`drive.snapshot`, `drive.act`, `drive.screenshot`, `drive.wait`)의 입력·출력, 폰의 거절 이유, agent가 받는 정한 문장, `tabs/open`의 `phone` target, screenshot의 JPEG. core(`mobile-drive-core`), 폰(`mobile-drive-native`, `mobile-drive-phone`), CLI(`mobile-drive-cli`)가 모두 이것 하나에 기댄다.

- 단위: drive-contract (wave 1)
- 선행: 없음. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land되고 `mobile-coding-agents`의 `mobile-host-link-cleanup`이 main에 있은 뒤에 띄운다**(`packages/protocol/phone/kinds.ts`는 `mobile-widgets`의 것이고, `packages/protocol/lophn-agent/host-queue.ts`는 cleanup이 고친다)
- 소유(이 task만 고친다):
  - `packages/protocol/phone/drive.ts`(새 file)
  - `packages/protocol/phone/drive_test.ts`(새 file)
  - `packages/protocol/phone/kinds.ts`
  - `packages/protocol/lophn-agent/host-queue.ts`
- 읽을 것:
  - 결정: 계획 `README.md`의 "정한 것" 전부. spike `/home/pyosechang/projects/lophn/reports/mobile-program/drive-spike.md`의 "Kotlin approach per action"과 "Survey changes"(1, 2, 6, 7). 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/browser-use-survey.md`의 2(a)~(d)와 4(모양의 출발점. 위 결정이 이긴다: event·답 route는 없다)
  - 폰 link: `packages/protocol/phone/{link,kinds}.ts`(`PHONE_KINDS`의 항목 꼴, `PHONE_RESPONSE_BYTES_MAX`, `*_base64` 칸 규칙, `phoneUnavailableReasonSchema`)
  - 탭과 browser route: `packages/protocol/lophn-agent/host-queue.ts`(`sharedTargets`, `hostTabTargetSchema`, `tabsOpen`, `browserActSchema`, `browserScreenshot`, `browserRead`, `BROWSER_WAIT_MAX_MS`), desktop snapshot 줄 `packages/shell/main/browser/agent/snapshot.ts`(`SNAPSHOT_MAX`, 이름 200자, `value=`, `[truncated]`), desktop wait의 시간 초과 문장 `packages/shell/main/browser/agent/driver.ts`(`The condition did not hold within …`)
  - view id: `packages/protocol/apps/views.ts`(`appViewIdSchema`)
  - architecture: `project-docs/architecture/browser-tab.md`(ref, take control, 정한 문장), `remote.md`
- 계약:
  - 쓰는 것: `phoneKindSchema`, `PHONE_KINDS`의 꼴, `appViewIdSchema`, `errorBodySchema`
  - 내놓는 것(`drive.ts`가 내고 `kinds.ts`의 `PHONE_KINDS`에 넷을 올린다):
    - 공통 입력 칸: `view`(`appViewIdSchema`. core가 고른 폰의 preview view), `by`(string 1..80. 부르는 agent의 이름, 사람 token이면 "Someone on your computer". 폰의 "is driving" 줄이 쓴다)
    - `driveNodeSchema` = `{node: int 1..1_000_000(폰이 snapshot마다 매기는 번호), depth: int 0..100, role: string 1..32(소문자: button, switch, checkbox, tab, tablist, link, header, textbox, image, text, list, listitem, scrollview, generic 가운데), name: string ≤200, value?: string ≤200(secure 칸은 "••••"), flags: ("disabled"|"checked"|"selected"|"scrollable"|"offscreen")[]}`
    - `drive.snapshot`: 입력 `{view, by}`. 출력 `{snapshot: string 1..64(폰이 낸 id), width_dp: int, height_dp: int, nodes: DriveNode[] ≤5000}`. deadline 10_000
    - `drive.act`: 입력 `{view, by, snapshot, act}`, `act`는 `type`으로 가른다: `{type: "click", node}` | `{type: "type", node, text ≤10_000}`(끝에 붙인다) | `{type: "fill", node, text ≤10_000}`(바꾼다) | `{type: "press", key: "Enter", node?}` | `{type: "scroll", node?, dy?: int -100_000..100_000(dp)}`(node면 그것을 화면 안으로, 아니면 dy만큼). 출력 `{}`. deadline 15_000
    - `drive.screenshot`: 입력 `{view, by, format: "jpeg" | "png"(기본 jpeg)}`. 출력 `{media_type: "image/jpeg" | "image/png", data_base64, width: int, height: int}`. 풀린 bytes는 `DRIVE_SCREENSHOT_BYTES_MAX` = 1 MiB 이하(`PHONE_RESPONSE_BYTES_MAX` 안). deadline 10_000
    - `drive.wait`: 입력 `{view, by, text: 1..1000, timeout_ms: 100..25_000}`. 출력 `{found: boolean}`. deadline 30_000(core는 `timeout_ms + 5_000`을 싣는다)
    - 폰의 거절: `unavailable`의 `details.reason`에 둘을 더한다: `no_preview`(그 view가 이 폰이 연 preview view가 아니거나 guest가 닫혔다), `screen_off`(화면이 꺼졌거나 창에 focus가 없다). 앱이 앞에 없으면 기존 `phone_in_background`. `conflict`의 `details.reason`: `driveConflictReasonSchema` = `taken_over`(사람이 take control 중. act만), `stale_ref`(그 snapshot이 마지막이 아니거나 node가 사라졌거나 role·name이 바뀌었다), `off_screen`(화면 안으로 들이지 못했다). 글을 칠 수 없는 node에 type·fill은 `invalid_input`
    - 정한 문장 `PHONE_TAB_TEXT`(core가 그대로 model에 준다. 원인, 다음 할 일, 되풀이가 통하는지): `notShowing`("The phone is not showing a preview of this app, so there is nothing to drive. Ask the person to open the app in the lophn app on the phone and choose Preview from lophn, then try again; retrying before that does not help."), `notInFront`("The lophn app on the phone is not in front or the phone screen is off, so lophn cannot drive it. Ask the person to unlock the phone and keep the preview open, then try again."), `tooOld`("The lophn app on the phone is too old to be driven. Ask the person to update the lophn app on the phone."), `timedOut`("The phone did not answer in time. Try once more; if it fails again, ask the person to check the phone."), `takenOver`("The person took control of this phone screen, so lophn does not act on it; snapshot and screenshot still work. Wait until the person hands it back, or ask them."), `staleRef`("This ref is from an older snapshot or the element is gone. Run browser snapshot again and use the new refs."), `offScreen`("lophn could not bring this element on screen to touch it. Scroll with browser act scroll, run browser snapshot again and use the new ref."), `unsupported(name)`("A phone tab supports snapshot, screenshot, read, wait --text and act click, type, fill, press Enter and scroll; <name> is not available on the phone."), `noShow`("A phone tab is on the phone, not in the lophn app on this computer; ask the person to look at the phone."). 문장 안에 `lophn ask` 명령을 쓰지 않는다(그런 CLI 명령은 없다. lophn agent는 자기 ask tool로, harness agent는 자기 대화로 묻는다)
    - snapshot 글의 규칙(core가 쓴다. 주석으로 둔다): 첫 줄 `screen <key> <w>x<h>dp`(ref 없음). 줄마다 `<depth만큼 두 칸>- <role>[ "<name>"][ value="<value>"][ [flag]…] [ref=eN]`(이름이 비면 뺀다, JSON 문자열 escape, desktop과 같은 순서에 flag만 더한다). 전체 `SNAPSHOT_MAX`(60_000)를 넘으면 그 앞에서 자르고 `[truncated]` 줄. ref는 탭마다 늘기만 하는 counter다
    - `packages/protocol/lophn-agent/host-queue.ts`:
      - `tabsOpen.input.target`에 `phoneTabTargetSchema` = `{phone: {app: idSchema("app"), screen: string 1..64 | null(기본 null)}}`를 더한다. `hostTabTargetSchema`(shell로 가는 target)에는 넣지 않는다: phone 탭은 shell에 가지 않는다
      - `tabsOpen` 윗줄 주석에 규칙: `phone`은 그 앱 workspace의 session과 사람 token만 연다(남의 앱은 `not_found`), 도는 preview가 없으면 `conflict`(desktop preview와 같은 문장), 폰이 그 preview를 보이지 않으면 `unavailable`(`notShowing`). 앱마다 phone 탭은 하나다
      - `browserScreenshot.output.image.media_type`을 `z.enum(["image/png", "image/jpeg"])`로
      - browser route 윗줄 주석에 phone 탭: 되는 것(snapshot, screenshot, read, wait의 text, act click·type·fill·press Enter·scroll), 안 되는 것은 `invalid_input`, `tabs/show`는 `invalid_input`. `browserRead`는 phone 탭에 `{url: "phone://<app id>/<screen>", title: "<screen>", loading: false}`, act·wait의 page도 같은 url·title이다
      - `browserCallPayloadSchema.view` enum은 넓히지 않는다(phone 호출은 shell queue에 들어가지 않는다)

## 할 일

1. `drive.ts`에 위 schema, type, `DRIVE_SCREENSHOT_BYTES_MAX`, `driveConflictReasonSchema`, `PHONE_TAB_TEXT`를 둔다. `kinds.ts`의 `PHONE_KINDS`에 넷을 올리고 `phoneUnavailableReasonSchema`에 `no_preview`, `screen_off`를 더하고 그 윗줄 주석에 뜻을 한 줄씩 적는다. `PHONE_KINDS`의 기존 `location.get`은 건드리지 않는다.
2. `host-queue.ts`를 위 "내놓는 것"대로 고친다. 옛 모양을 지우는 것은 없다(더하기와 enum 넓히기뿐).
3. `drive_test.ts`: 각 kind의 입력·출력 하나씩이 통과하고, `drive.act`의 모르는 `type`과 `press`의 Enter 밖 key가 실패하는 것만 본다(모양 test는 이 정도로 그친다).
4. flows catalog: 새 test file과 바뀐 `tabs/open` 입구의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다(이 task는 쓰는 쪽이 아직 없어 type만 맞으면 된다. `browserScreenshot`의 enum을 넓혀 깨지는 곳이 있으면 그 file을 고치지 말고 보고한다).
- 위험 test: 없음(모양뿐. 경계는 `mobile-drive-core`와 `mobile-drive-phone`이 test한다)
- 남지 않음: 없음(더하기뿐).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 각 kind의 입력·출력 예 하나씩(JSON), 등록할 것(`packages/protocol/phone/mod.ts`의 `export * from "./drive.ts"`), 정한 문장 목록.
