# mobile-local-screens

폰 앱의 화면에 폰에서 도는 앱을 보인다: 앱 위 줄의 이름 아래 한 줄("On this phone · synced <time>", standalone은 "Only on this phone · not backed up", 맞추지 못했으면 그 상태), 컴퓨터가 offline일 때 Home의 앱 tile(폰에서 도는 앱은 흐리지 않는다)과 offline 안내의 한 문장, 설치 중과 설치 실패의 상태. 승인된 wireframe의 코드를 옮긴다.

- 단위: phone-host (wave 7)
- 선행: mobile-local-sync-phone. lead가 `packages/design/i18n/catalog/mobile-local-apps.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린 뒤에 띄운다
- 소유(이 task만 고친다). 실제 file 이름은 단계 6과 `mobile-app` land 뒤 lead가 맞춘다:
  - `packages/mobile/src/screens/apps`(앱 위 줄의 아래 한 줄과 설치·실패 상태)
  - `packages/mobile/src/screens/home/apps.tsx`(tile을 흐리는 조건)
  - `packages/mobile/src/screens/home/offline.tsx`(안내 문장)
  - `packages/design/i18n/catalog/mobile-local-apps.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/apps.tsx`의 `Calendar`(`TopBar`의 `under="On this phone · synced just now"`)와 caption, `tools/wireframes/drafts/phone/shell.tsx`의 `Apps({offline})`(Calendar·Reading list tile은 offline에도 흐리지 않는다)와 offline 안내("Sessions and apps that run on it are paused here. Apps that live on this phone keep working and sync when it is back."), 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/`의 Apps와 Home offline
  - 계획 `README.md` "정한 것"(표시 글, 말없는 LWW: 충돌 화면이 없다)
  - data: `packages/mobile/src/data/local-apps.ts`(`mobile-local-sync-phone`: 목록과 `kind`, `last_synced_at`, `pending`, `state`, `failure`), 그 task의 보고(상태의 뜻)
  - 지금 화면: 단계 6의 앱 화면(`packages/mobile/src/screens/apps`, 위 줄), `packages/mobile/src/screens/home/{apps.tsx,offline.tsx}`(`mobile-home`), 문구 `packages/design/i18n/catalog/{mobile-home.ts,mobile-apps.ts}`
  - kit: `packages/design/native/mod.ts`
- 계약:
  - 쓰는 것: `local-apps.ts`의 hook. kit에 없는 조각은 자기 폴더에 두고 보고한다(kit은 고치지 않는다)
  - 문구: `@lophn/i18n`의 `t()`. desktop과 폰 catalog에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 `mobile-local-apps.ts`에 `mobile.local.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장, 시각은 ICU 인자)

## 할 일

1. 앱 위 줄의 아래 한 줄(폰에서 도는 앱만): sync 앱 `ready`는 "On this phone · synced {time}"(시각은 desktop과 같은 상대 시각 규칙. "just now"), `syncing`은 "On this phone · syncing", 맞추지 못했거나 컴퓨터에 닿지 않는데 `pending`이 있으면 "On this phone · not synced since {time}". standalone은 늘 "Only on this phone · not backed up". 컴퓨터에서 도는 앱(단계 6)은 그대로다.
2. 설치 중(`installing`)과 설치 실패(`failed`, `failure` 한 줄과 다시 하기 단추): 앱 화면 본문 자리. 컴퓨터에 닿지 않아 처음 설치를 못 하면 단계 6의 "needs its computer" 화면을 그대로 쓴다(그 앱은 아직 폰에 없다).
3. Home(`apps.tsx`): 컴퓨터가 offline이면 컴퓨터에서 도는 앱 tile만 흐린다. `offline.tsx`: 그 컴퓨터에 폰에서 도는 앱이 있으면 wireframe의 두 문장, 없으면 지금 문장.
4. emulator 그림(아래 규칙): sample 컴퓨터(`EXPO_PUBLIC_LOPHN_SAMPLE=1`)에 폰에서 도는 앱(sync 하나, standalone 하나)이 없으면 `packages/mobile/src/data/sample.ts`에 더하는 것을 "넘길 줄"로 보고하고, 개발 core(`tools/remote-dev.ts`)와 `mobile-local-sync-phone`의 fixture로 찍는다. 찍을 것: sync 앱 위 줄(synced, syncing, not synced), standalone 위 줄, 설치 중, 설치 실패, Home offline(tile과 안내). light 전부, dark 둘.

## Android 확인 규칙

- emulator는 AVD `lophn-phone`을 `-read-only -memory 2048 -port 5628`로 띄우고 모든 adb 명령에 `-s emulator-5628`을 붙인다. 끝나면 `adb -s emulator-5628 emu kill`로 끈다. Metro는 port 8268이다.
- native module을 더하지 않는다. lead가 지어 둔 dev build `/tmp/lophn-mobile-local-apps-x86_64.apk`를 쓴다.
- 사람의 실제 폰(adb serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process는 직접 끈다.
- 사람의 `~/.lophn`, 실제 relay, 실제 model provider를 쓰지 않는다.
- 그림은 `.dev-data/mobile-local-screens/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test: 없음(화면과 문구).
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).
- flows catalog: 이 task가 바꾼 폰 화면 동작의 줄이 있으면 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록, 더한 i18n key, wireframe과 다르게 한 곳과 이유, 실제 core로 확인한 것과 못 한 것.
