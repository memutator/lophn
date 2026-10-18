# browser-bridge: terminal이 연 URL을 browser 탭에 띄운다

- 목표: shell 탭과 coding 탭의 env에 `BROWSER` shim을 넣고, shim이 Electron main의 unix socket bridge로 URL을 보내 browser 탭에 연다. terminal의 http/https link를 Ctrl/Cmd-click으로 연다. web과 local link를 열 곳을 Settings에서 고른다.
- 재료:
  - `project-docs/products/roadmap/browser-tab.md`: "지금 코드"의 terminal, "무엇을 만드나" 2·4(link 설정), "정한 것".
  - `../rea/project/desktop-embeded-browser`의 `src/main/bridge.js`, `src/shim/browser-shim.js`, `src/main/policy.js`(`isRelayableUrl`, `parseBridgeRequest`, `PRIVATE_HOST_PATTERNS`), `analysis/embedded-browser-reverse-engineering.md` 2.7절.
  - 계획 `browser-tab`이 쓴 `project-docs/architecture/browser-tab.md`, `project-docs/architecture/coding-agent.md`.
- 범위 밖: Windows bridge, shell chrome과 app view의 `open-external` 돌리기(roadmap "하지 않는 것").
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `bb-`로 시작한다.
- 순서: bridge protocol과 판정 함수(wave 1) → socket 서버와 탭별 key·shim과 env 주입·terminal link·link 설정(wave 2) → gallery(wave 3) → 문서(lead).
- 시작 조건: 계획 `browser-tab`이 main에 land한 뒤. 그 전에는 README만 있다. land하면 planner가 `wrap-plan`으로 browser-tab을 닫고, worker 하나에게 실제 코드로 brief를 쓰게 한 뒤 lead를 띄운다.

## 정한 것

- brief를 지금 쓰지 않는다(agent). 여는 길(browser 탭 kind와 여는 함수)을 `browser-tab`이 만든다.

## lead가 할 일

- 끝나면:
  - `project-docs/architecture/browser-tab.md`에 bridge 흐름과 link 설정을, `project-docs/architecture/coding-agent.md`에 coding 탭 env의 `BROWSER`를 더한다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/browser-tab.md`를 지운다(3 로컬 HTML 미리 보기만 남으면 그 절만 남긴다).
- 사람에게 묻는 것: child process를 띄우는 test를 새로 만들 때. `gh auth login --web`은 lead가 손으로 확인한다.
