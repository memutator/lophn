# multi-machine: 한 사람의 lophn 여럿

상태: 열지 않음. 2026-11-15 사람이 방향을 냈고 planner가 정리했다. 바탕인 relay(`mobile.md` 단계 3, 계획 `remote-relay`)와 sync 앱(`mobile.md` 단계 7) 뒤에 연다.
배경 문서: `project-docs/products/roadmap/mobile.md`("remote와 모바일 앱은 다른 것이다", "폰에서 혼자 도는 앱", "사람이 정할 것" 4), `project-docs/products/roadmap/standalone-core.md`, `project-docs/architecture/{remote,platform,event}.md`.

## 사람의 말 (원문)

2026-11-15:

> 그럼 우리가 multi device 능력을 확대해서 사용자가 개인 서버 , 미니 피시 같은 게 서버 역할 하도록 이전시키는 것도 가능할려나

> 거기서도 자체적으로 lophn을 깐다는 전제 하에

## 왜

- 폰에서 혼자 도는 sync 앱(캘린더)은 "core에 닿으면 맞춘다". 그 core가 desktop 하나뿐이면 desktop이 꺼진 동안 맞출 상대가 없다.
- 늘 켜진 기계(미니 PC, 홈 서버)에 lophn을 하나 더 두면 cloud 없이 사람 자기 기계로 늘 켜진 sync 상대와 job·앱 backend를 갖는다.
- core는 이미 shell 없이 선다(`standalone-core`). 화면 없는 기계에서 CLI로 core를 켤 수 있다.

## 모양 (planner 추천)

- 기계마다 lophn이 하나씩 깔리고 각자 core와 ledger를 갖는다. 원본을 한 곳으로 옮기지 않는다.
- core끼리는 폰과 같은 길로 붙는다: pairing이 기기 등록이고, Noise 연결과 relay를 그대로 탄다. 한 core가 다른 core에 기기로 등록된다.
- 폰은 이미 컴퓨터를 여러 대 pairing한다. 기계마다 remote 화면을 따로 연다.
- agent와 session은 그 기계의 것이다. agent는 그 기계의 project 폴더와 터미널에서 돈다. 폰은 기계마다 remote로 본다.

버린 안: core를 미니 PC 하나로 옮기고 desktop은 client로 붙는다. agent의 file, shell, 터미널, coding agent 길을 모두 network 너머 desktop host에 시켜야 해서 가장 큰 공사이고, 사람이 일하는 project는 desktop에 있다.

## 정할 것 (단계를 열 때)

1. **core끼리 무엇을 맞추나.** 추천: sync 앱의 data와 그 앱의 release만. session, 대화, project는 맞추지 않는다(그 기계의 file 위에서 일어난 일이다). agent 정의, skill, 설정을 맞출지는 따로 정한다.
2. **화면 없는 lophn 관리.** provider key와 secret은 지금 desktop의 보호 입력 창으로만 넣는다(`architecture/approval.md`). 추천: desktop lophn이 pairing한 다른 lophn에 사람 자격으로 붙어 그 설정과 secret 화면을 연다. 그러려면 "사람 자격의 remote 연결"이 기기 자격과 따로 서야 한다.
3. **앱이 어디서 도나.** SDK의 세 길(remote, sync, 독립)을 기계 여럿으로 넓힌다: sync 앱은 모든 기계에서 돌고 맞춘다. remote 앱은 한 기계에서 돌고 나머지는 화면을 띄운다. 어느 기계를 그 앱의 집으로 둘지 사람이 고른다.

## 순서

1. relay: 어느 기기끼리든 어디서든 닿는다(계획 `remote-relay`).
2. sync 앱: 폰↔core의 맞추기를 처음부터 "상대가 기기 누구나"로 짠다(core↔core도 같은 changeset 길).
3. 이 roadmap: core끼리 pairing, 화면 없는 lophn 관리, 무엇을 맞출지.
