# machine-phone

폰 앱을 새 hello에 맞춘다. 컴퓨터를 주소("192.168.0.3") 대신 그 컴퓨터가 알린 이름으로 보이고, 사람이 "Shown as"로 붙인 별명이 있으면 별명을 보인다. pairing 때 컴퓨터의 machine id를 저장해 연결마다 자격을 보내기 전에 확인하고, 같은 id의 항목은 하나로 접는다. 폰은 자기 이름을 갖고(Settings › This phone) 연결마다 알린다. `pair`는 kind phone을 싣는다.

- 단위: machine-phone (wave 3)
- 선행: machine-hello, machine-device-kind
- 소유(이 task만 고친다):
  - `packages/mobile/src/remote.ts`
  - `packages/mobile/src/pairing`
  - `packages/mobile/src/connection`
  - `packages/mobile/src/data/computers.ts`
  - `packages/mobile/src/data/computers.test.ts`
  - `packages/mobile/src/data/hooks.tsx`
  - `packages/mobile/src/screens/start/pairing.tsx`
  - `packages/mobile/src/screens/settings/index.tsx`
  - `tools/wireframes/drafts/phone/start.tsx`
  - `tools/wireframes/drafts/phone/more.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/machine-identity/README.md`의 "정한 것"(별명과 알린 이름, 기계 자기 이름, 자격 전 확인, protocol 2)과 "다른 계획이 기대는 계약" 2·3·4
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` A("What the phone shows as the computer's name"), B("What the phone app adds")
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 2.2~2.3(알린 이름, 보는 쪽 별명, 지우면 아래 층으로), 4.3(같은 기계는 경로 더하기로)
  - architecture: `project-docs/architecture/remote.md`(폰의 key와 컴퓨터 목록, unpair)
  - 폰 개발: `packages/mobile/README.md`(명령, emulator 규칙, 개발 core와 pairing하는 길 `tools/remote-dev.ts`, 화면 규칙). `packages/mobile`은 root workspace와 `npm run check` 밖이다
  - 본보기(화면): wireframe `tools/wireframes/drafts/phone/start.tsx`의 `Paired`, `tools/wireframes/drafts/phone/more.tsx`의 컴퓨터 상세("Shown as" 줄)와 Settings
  - 앞 task의 결과: `packages/protocol/remote/{frames,channel,client}.ts`의 hello 둘, `connectRemote`의 `name`·`machine`, client `peer.machine`, kind로 갈린 `pair`(machine-hello, machine-device-kind)
  - 지금 코드: `pairing/store.ts`(`Computer`, SecureStore key `computers`·`device-key`), `pairing/pair.ts`(`thisDevice`의 `Platform.constants.Model`, `pair`), `connection/connection.ts`(`openFirst`, `createConnection`), `data/computers.ts`(`defaultName`, 다시 pairing해도 옛 별명을 남기는 `pair`, `rename`), `data/hooks.tsx`, `screens/start/pairing.tsx`(`PairedScreen`의 이름 input), `screens/settings/index.tsx`(컴퓨터 상세의 "Shown as"와 그 sheet)
  - i18n: `packages/design/i18n/catalog/mobile-app.ts`(`mobile.` key. key를 더하기만 한다)
- 계약:
  - 쓰는 것: README "다른 계약" 2(hello, `connectRemote`, 접기 규칙), 3(phone `pair`), 4(폰 쪽 칸)
  - 내놓는 것: 없음(폰 앱)

## 할 일

1. 저장(`pairing/store.ts`): `Computer`는 `name?`(사람의 "Shown as" 별명. 지금 칸과 뜻 그대로라 저장된 별명은 손대지 않고 남는다), 새 `announced?: string`(그 컴퓨터가 hello로 마지막으로 알린 이름), 새 `machine?: string`(그 컴퓨터의 `mch_` id. 이 판 전에 pairing한 항목은 첫 연결에서 배운다)를 갖는다. 보이는 이름은 `name ?? announced ?? defaultName(computer)`이다. 폰 자기 이름은 SecureStore key `phone-name`(없으면 기본값)이다.
2. 폰의 이름: 기본은 지금 `thisDevice`의 값(`Platform.constants.Model`, 없으면 `<os> phone`, 40자). 모든 연결(`openFirst`의 `connectRemote`)이 client hello `name`(protocol 상한 64자)으로 보낸다. 폰 화면의 이름 칸은 40자로 둔다(컴퓨터의 preview 기기 화면 `shell.devices` 이름이 40자다). `pair` frame은 `kind: "phone"`과 os·화면 칸만 싣는다(이름은 hello가 싣는다).
3. 연결: `openFirst`가 저장된 `machine`이 있으면 `connectRemote({ …, machine })`로 준다. 다르면 channel이 열리지 않으므로(core의 hello만 받고 아무것도 보내지 않는다) 그 시도는 닿지 않은 것으로 끝난다(상태는 지금의 offline. 새 상태를 만들지 않는다). channel이 열리면 `peer.machine`의 id와 이름을 `Computers`에 알려, `machine`이 비었으면 적고 `announced`가 다르면 고쳐 저장한다. 별명(`name`)은 연결이 바꾸지 않는다.
4. pairing(`pair.ts`, `data/computers.ts`): `pair`가 `peer.machine`을 결과에 싣는다. 저장할 때 같은 `key`나 같은 `machine` id인 옛 항목을 하나로 접는다(새 항목이 옛 항목의 key·주소·기기 id를 바꾸고, 옛 별명은 지금처럼 남기고, 고른 컴퓨터도 그쪽으로 옮긴다). `rename(key, name: string | null)`: null이나 빈 글이면 별명을 지워 알린 이름이 다시 보인다.
5. 화면(새 화면은 만들지 않는다):
   - Paired(`screens/start/pairing.tsx`): "Paired with <보이는 이름>". 이름 input은 남기되 빈 값으로 시작하고 placeholder가 알린 이름이다. 비워 두면 별명이 없다(알린 이름이 보인다). 무언가 쓰면 별명이 된다. 알림 묻기는 그대로다.
   - 컴퓨터 상세(`screens/settings/index.tsx`): "Shown as" 줄은 보이는 이름이고, 별명이 있고 알린 이름과 다르면 그 아래 작게 알린 이름("My Galaxy" 아래 "Calls itself mina-desktop" 꼴). sheet의 placeholder는 알린 이름이고, 별명이 있으면 [Use the computer's name] 단추가 별명을 지운다.
   - Settings에 "This phone" group: Name 줄(sheet로 바꾼다. 1~40자. 빈 값이면 기본값으로). 바꾸면 붙어 있는 연결을 다시 열어(pause·resume) 컴퓨터가 바로 새 이름을 받게 한다. note 한 줄: 컴퓨터에서 이 폰에 별명을 붙였으면 그 컴퓨터에서는 별명이 보인다.
   - wireframe을 먼저 같은 모양으로 고친다: `start.tsx`의 `Paired`(placeholder가 알린 이름), `more.tsx`의 컴퓨터 상세(별명 아래 알린 이름, 되돌리기 단추)와 Settings의 "This phone". 화면은 그 wireframe을 옮긴다.
6. 문구: `mobile-app.ts`에 새 key를 더한다(`mobile.computer.label.announced-name`, `mobile.computer.button.use-computer-name`, `mobile.settings.heading.this-phone`, `mobile.settings.label.phone-name`, `mobile.settings.note.phone-name-alias` 같은 이름. 이웃 꼴을 따른다). `mobile.computer.label.shown-as`는 남긴다.
7. `src/remote.ts`가 새 type(`RemotePeer`의 machine 등)을 내보내는지 맞춘다.

## 끝남

- `npm run check`가 통과한다(root. wireframe과 i18n이 root에 있다).
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test(`computers.test.ts` 또는 `connection.test.ts`):
  - "옛 모양의 `computers` 값(별명 `name`만 있고 `machine`·`announced` 없음)이 연결 뒤에도 별명을 그대로 지키고 id와 알린 이름을 배우며, 같은 machine id로 다시 pairing하면 항목이 하나로 남고 별명이 남는다"
  - "저장된 machine id와 다른 컴퓨터가 답하면 그 연결로 아무 frame도 보내지 않는다"
- emulator 확인: port 5632, Metro 8272. AVD `lophn-phone`을 `-read-only -memory 2048 -port 5632`로 띄우고 모든 adb 명령에 `-s emulator-5632`를 붙이고 끝나면 `adb -s emulator-5632 emu kill`로 끈다. JS만 바뀌므로 있는 dev build로 되면 다시 짓지 않는다(없으면 README대로 짓는다). 개발 core(`packages/mobile/README.md`의 `tools/remote-dev.ts` 길, direct)와 pairing해서 Paired에 컴퓨터 이름이 나오는지, 컴퓨터 쪽 `machine/rename` 뒤 다시 붙으면 새 이름이 나오는지(별명이 있으면 별명 아래에), 폰 이름을 바꾸면 컴퓨터의 `devices/list`의 `announced_name`이 바뀌는지 본다. 그림을 `.dev-data/machine-phone/shots/`에 둔다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일은 하지 않는다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. 사람의 `~/.lophn`과 실제 relay를 쓰지 않는다.
- 남지 않음: `grep -rn "core does not send its own name" packages/mobile/src`가 0줄이다(옛 주석).
- flows catalog: 폰 쪽 journey(`project-docs/flows/journeys/phone.yaml`)와 바뀐 pairing·컴퓨터 상세 줄을 고친다(자기 줄만). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: emulator 그림 path와 wireframe과 다른 곳, 이 판 전에 pairing한 항목이 다시 pairing 없이 이름과 id를 배우고 별명을 지킨 것을 본 방법, lead가 고칠 목록(`packages/mobile/README.md`의 폰 이름과 "폰 앱과 core를 같이 올린다").
