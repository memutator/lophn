# mobile-drive-verify

**lead가 직접 돈다.** emulator와 개발 core(fake model)로 처음부터 끝까지 돌려 본다: 앱 workspace의 agent session이 CLI로 phone 탭을 열고 snapshot, 누르기, 치기, scroll, screenshot, wait를 하고, 사람이 폰에서 take control과 hand back을 하고, 연결을 끊는다. 새 자동 test file을 만들지 않는다(emulator E2E test는 사람에게 먼저 묻는다). 결과는 보고서와 `packages/mobile/README.md`의 drive 절로 남긴다.

- 단위: drive-check (wave 5)
- 선행: mobile-drive-phone, mobile-drive-core, mobile-drive-cli, mobile-drive-guidance. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤다**(앞 task들이 이미 그 뒤다)
- 소유(이 task만 고친다):
  - `packages/mobile/README.md`(drive 절. `mobile-drive-native`의 보고에 있는 초안을 옮겨 다듬는다)
- 읽을 것:
  - 앞 task의 보고 전부(특히 `mobile-drive-native`의 debug·release 표와 build 명령, `mobile-drive-phone`의 7번 결과)
  - 계획 `README.md`의 "정한 것", "돌리기 전에", "사람이 할 것"
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/browser-use-survey.md`의 6의 4(host UI에 입력이 새지 않는지의 emulator 확인)
- 계약:
  - 쓰는 것: 이 계획이 지은 것 전부. 고치지 않는다. 틀린 곳은 이슈(`issue` skill)나 해당 task로 돌려보낸다

## 할 일

1. plan branch에서 release build(x86_64, debug 서명, R8 켬)를 짓고 emulator(port 5618, Metro 8258)에 깐다. 개발 core는 `tools/remote-dev.ts` 길(fake model)로 띄우고 pairing한다.
2. 개발 core에 앱 하나를 만들고 폰 화면(입력 칸이 `Field` 안에 있고, 긴 목록과 operation 단추가 있는 것)을 손으로 쓰고 release하고 `lophn preview start`.
3. 폰에서 그 앱 화면 → Preview from lophn. 컴퓨터에서 그 앱 workspace의 session 자격으로(fake model이라 CLI를 그 session의 자격으로 직접 부른다) `lophn tab open --phone <app>`, `browser snapshot`(Field label이 이름인가, `[offscreen]`), `act click`(operation이 preview process로 불리고 화면이 바뀐다), `act fill`·`press Enter`, `act scroll --ref`로 아래 줄 누르기, `browser screenshot`(`.jpg`, 크기), `browser wait --text`, `browser read`.
4. 거절: 다른 앱 workspace의 session이 `--phone`을 열면 `not_found`, preview를 멈추면 `conflict`/`unavailable`, 폰에서 화면을 떠나면 `unavailable`(`notShowing` 문장), HOME과 화면 끔 뒤 `unavailable`(`notInFront`), Take control 뒤 act `conflict`·snapshot 됨, Hand back 뒤 됨, 옛 ref `conflict`, core에서 연결을 끊으면 `unavailable`.
5. 입력이 host에 새지 않는가: guest 가장자리와 host 위 줄 근처를 가리키는 ref를 누를 때 host 단추가 눌리지 않는다(조사 6의 4).
6. 결과를 `/home/pyosechang/projects/lophn/reports/mobile-program/drive-verify.md`에 쓴다(명령, 결과, 그림 경로 `.dev-data/mobile-drive-verify/shots/`, 숫자). `packages/mobile/README.md`에 drive 절(구조, 개발에서 확인하는 길, 알려진 한계)을 쓴다. emulator와 core를 끈다(`adb -s emulator-5618 emu kill`).
7. 실제 폰 확인은 사람이 build를 깐 뒤(README "사람이 할 것", planner가 묻는다) 같은 3~4번을 한 번 한다. 그 전까지 보고서에 "실제 폰: 아직"으로 둔다.

## Android 확인 규칙

- AVD `lophn-phone`을 `-read-only -memory 2048 -port 5618`로, 모든 adb 명령에 `-s emulator-5618`. gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, release는 `--max-workers=1`. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 build를 사람이 깐 뒤 7번에서만, 사람이 정한 방법으로 다룬다(adb 명령을 보내지 않는다. 폰의 lophn 앱이 core에 붙는 길로만 본다). `pkill`·`killall` 금지. 실제 relay·model provider와 사람의 `~/.lophn`을 쓰지 않는다.

## 끝남

- 3~5번이 모두 기대대로이거나, 아닌 것마다 이슈나 돌려보낸 task가 있다.
- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test: 없음(새 test file을 만들지 않는다).
- flows catalog: 고칠 줄이 없다(새 입구나 test file이 없다).

## 보고

보고서 `/home/pyosechang/projects/lophn/reports/mobile-program/drive-verify.md`가 보고다. 계획을 닫을 때 change-log에 실제 폰 확인을 했는지 적는다.
