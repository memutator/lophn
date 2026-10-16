# task brief

task 하나에 file 하나다. 오케스트레이터는 이 file의 절대 경로를 worker에게 넘기고, worker는 이 file과 AGENTS.md만 보고 일을 끝낼 수 있어야 한다.

## 이름

- file 이름은 task id다: `<단위>-<하는 일>.md`(소문자 영어, `-`). 예: `events-reactor.md`, `screens-project-editor.md`.
- 번호, wave, 단계 이름을 넣지 않는다.
- 단위에 task가 하나면 단위 이름 그대로 쓴다(예: `check.md`).

## 크기

- worker 하나가 한 session에 끝낼 크기로 나눈다. 단위가 크면 task 여럿으로 쪼갠다.
- 같은 단위의 task끼리 소유 path가 겹치면 안 된다. 겹치면 "선행"으로 순서를 정한다.
- 서로 기대지 않는 task는 선행을 두지 않는다. 동시에 돌수록 빠르다.

## 꼴

```markdown
# <task id>

<무엇을 하는지 한두 문장>

- 단위: <단위> (wave <N>)
- 선행: <task id, ...> | 없음
- 소유(이 task만 고친다):
  - `<path>`
- 읽을 것:
  - spec: <S?> <N>장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/<file>.md`
  - inventory: `I2.1#3`, `U2.3#5`, … (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 3장 #<n>
  - 본보기(화면): `tools/wireframes/frames/...`
- 계약:
  - 쓰는 것: <고정된 protocol, port, IPC의 file과 이름>
  - 내놓는 것: <다른 task가 기대는 것. wave 2 task는 여기에 모양을 적는다>

## 할 일

1. <순서대로. 지울 것, 고칠 것, 새로 만들 것을 file과 이름으로 적는다>

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "<결과 한 문장>" | 없음
- 남지 않음: `grep -rn "<옛 이름>" packages tools`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `<page>`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
```

## brief를 쓸 때 지킬 것

- **재료를 인용한다.**
  - 할 일마다 근거가 되는 spec 장이나 inventory 줄 번호를 붙인다.
  - 문서에 없는 일을 만들지 않는다. 필요하면 "정한 것"으로 적고 이유를 쓴다.
- **소유는 실제 path다.**
  - 지금 코드를 열어 확인한 file과 폴더를 적는다.
  - `../ownership.md`의 그 단위 밖 path는 적지 않는다.
- **계약 단위(wave 2)의 brief는 모양을 적는다.**
  - type 이름, 칸, route 이름, event 이름, IPC channel 이름, port 함수의 꼴을 spec에서 옮긴다.
  - 옛 계약은 지우지 않고 새것을 옆에 더한다. 옛것을 쓰는 곳이 남아 있기 때문이다. 옛것은 wave 3 task와 cleanup이 지운다.
- **화면 단위의 brief는 wireframe 코드를 옮긴다.** 보고 다시 그리지 않는다(`../README.md` 2.5).
  - wireframe file과 그것이 갈 renderer 위치를 짝지어 적는다.
  - 가짜 data를 대신할 source(`source.ts`, `core-source.ts`, fake source)를 적는다.
  - 박아 둔 글을 바꿀 wording key 영역을 적는다.
- **위험 test는 `../../dev/testing.md` 기준이다.** 데이터 손실, 권한·secret·sandbox 경계, 결정적 판정만 쓴다. 화면, 문구, 내부 구현은 test하지 않는다.
- **말**: 개발자가 쓰는 말을 쓴다(AGENTS.md). "자리", "시험" 같은 번역어를 쓰지 않는다.
