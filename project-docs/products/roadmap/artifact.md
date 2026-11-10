# artifact: 남은 일

상태: 로드맵. 계획 `artifact`가 artifact model, artifact 탭, prompt 목록과 대화 link, 내장 guide, artifact annotation을 land했다. 흐름과 지키는 것은 `project-docs/architecture/artifact.md`다. 남은 것은 없고 아래는 하지 않기로 한 것이다.
배경 문서: `project-docs/architecture/artifact.md`.

## 남은 일

없다. 화면에서 artifact 지우기도 land했다(`architecture/artifact.md` 불변식 24).

## 하지 않는 것

- **인터넷 page(browser 탭)의 annotation.** transport와 받는 쪽이 정해진 뒤 따로 roadmap을 쓴다.
  - transport: guest preload 없이, main이 isolated world에 다음 event를 기다리는 호출을 되풀이하는 long-poll이 되는지 확인해야 한다.
  - 받는 쪽: browser-bridge가 아는, 그 page를 연 terminal이다.
- **artifact 공유, 내보내기, 판 기록.** 파일 rewind가 있다. 사람이 lophn 밖에서 봐야 하면 [폴더 열기]나 내보내기를 그때 붙인다.
- **외부 library와 CDN.**
- **대화 안에 artifact를 live로 끼워 그리기.** link로 탭을 연다.
- **tool을 부르는 화면.** 앱의 일이다(`architecture/app-call.md`).
