---
type: screen
concerns: [shell/terminal, shell/workspace]
---
# terminal

project-workspace의 탭 하나다. 사람이 프로젝트 폴더에서 명령을 실행한다.

## 보이는 것

1. **시작 위치.** 어느 프로젝트 폴더에서 열렸는지 상대 경로로 보인다(shell/terminal#R1).
2. **출력.** 지금까지의 명령 결과(scrollback)를 보인다(shell/terminal#R7).
3. **실행 중인 shell 이름.** login shell 또는 PowerShell 7 / PowerShell 5.1처럼, 실제로 실행한 것을 그대로 보인다(shell/terminal#R4).
4. **폴더 고르기.** 등록 폴더가 둘 이상이고 아직 고르지 않았으면, 시작 전에 고르는 화면만 먼저 보인다(shell/terminal#R1).

## 숨긴 것

- lophn의 내부 token·연결 자격·confirmation handle은 이 터미널의 환경에 전달되지 않으며, 화면 어디에도 나타나지 않는다(shell/terminal#R5).
- 실행한 shell의 정확한 실행 파일 경로와 시작 인자는 기본으로 보이지 않고, "자세히 보기"에서만 펼친다(shell/terminal#R4).
- 보존 상한(10,000줄 또는 5MiB)을 넘겨 제외된 과거 출력은 "일부 생략" 표시만 남고 되살리지 않는다(shell/terminal#R7).

## 행동

- 주 행동: 없음(이미 시작된 터미널은 명령을 직접 입력하는 화면이다). 폴더를 아직 고르지 않았을 때만 **Choose folder**가 주 행동이다.
- 보조: 종료된 자리에서 **Start again**, 살아 있는 작업이 있을 때 탭 닫기를 누르면 뜨는 종료 확인.

## 상태

- **폴더 고르는 중.** 여러 등록 폴더 중 하나를 고르기 전에는 시작하지 않는다(shell/terminal#R1).
- **실행 중.** 입력과 출력을 주고받는다. 포커스가 있는 터미널만 입력을 받는다(shell/terminal#R3).
- **종료됨.** 정상 종료 / 강제 종료 / 결과 모름을 구별해 출력 옆에 남긴다. 이전 입력을 다시 실행하지 않는다(shell/terminal#R9).
- **닫기 확인.** 살아 있는 작업이 있는 터미널을 닫으려 하면 먼저 확인하고, 취소하면 그대로 유지한다(shell/terminal#R10).
- **폴더를 열 수 없음.** 시작 위치가 없거나 읽을 수 없으면 이유를 보이고 다른 폴더로 조용히 바꾸지 않는다(shell/terminal#R2).

## 문구

| key | en |
|---|---|
| terminal.choose_folder.title | Choose a folder to start the terminal in |
| terminal.choose_folder.action | Choose folder |
| terminal.status.exited.normal | Finished |
| terminal.status.exited.forced | Stopped |
| terminal.status.exited.unknown | Ended (result unknown) |
| terminal.restart | Start again |
| terminal.close_confirm.title | A command is still running |
| terminal.close_confirm.body | Closing this tab may end it. |
| terminal.close_confirm.close | Close anyway |
| terminal.close_confirm.cancel | Keep it open |
| terminal.error.folder_unavailable | This folder can't be used right now |
| terminal.truncated | Some earlier output was dropped to save space |

## 크기와 접근성

- 입력 focus는 사람이 선택한 탭에만 가고 다른 탭으로 새지 않는다(shell/terminal#R3).
- 탭 전환·숨김 중에도 shell과 출력은 유지된다(shell/terminal#R7).
- 터미널은 OS 사용자 권한으로 동작하며 lophn 앱 sandbox가 아니라는 점과, 프로젝트 폴더 밖 접근을 lophn이 막지 않는다는 점을 첫 열기 안내에 함께 보인다(shell/terminal#R6).
