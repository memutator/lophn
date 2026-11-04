# artifact: 남은 일

상태: 로드맵. 계획 `artifact`가 artifact model, artifact 탭, prompt 목록과 대화 link, 내장 guide, artifact annotation을 land했다. 흐름과 지키는 것은 `project-docs/architecture/artifact.md`다. 남은 것은 아래뿐이다.
배경 문서: `project-docs/architecture/artifact.md`.

## 남은 일

- **화면에서 artifact 지우기.** sidebar의 Artifacts 목록에 지우기 단추를 둔다(wireframe에서 고른 줄과 hover에만 보이는 휴지통). 사람이 2026-10-19에 이번 계획에서 빼기로 정했다.
  - 지운 폴더는 rewind로 되살릴 수 없다. 확인 대화상자와, 지우기가 그 artifact 폴더 밖을 건드리지 않는 위험 test가 필요하다.
  - shell IPC에 delete channel을 더하고 main이 `artifacts/<name>/`을 지운다. 열린 탭은 폴더 없음 안내로 바뀐다.
  - 지금은 agent에게 지우라고 하거나 파일 관리자로 지운다.

## 하지 않는 것

- **인터넷 page(browser 탭)의 annotation.** transport와 받는 쪽이 정해진 뒤 따로 roadmap을 쓴다.
  - transport: guest preload 없이, main이 isolated world에 다음 event를 기다리는 호출을 되풀이하는 long-poll이 되는지 확인해야 한다.
  - 받는 쪽: browser-bridge가 아는, 그 page를 연 terminal이다.
- **artifact 공유, 내보내기, 판 기록.** 파일 rewind가 있다. 사람이 lophn 밖에서 봐야 하면 [폴더 열기]나 내보내기를 그때 붙인다.
- **외부 library와 CDN.**
- **대화 안에 artifact를 live로 끼워 그리기.** link로 탭을 연다.
- **tool을 부르는 화면.** 앱의 일이다(`architecture/app-call.md`).
