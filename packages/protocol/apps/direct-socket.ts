import { DIRECT_SOCKET_PATHS } from "./channel-values.ts";

export { DIRECT_SOCKET_PATHS };

// 읽기 결과의 원천 상태. 정상 0행과 미수집·부분 범위·신선도 부족을 구분한다.
// 값을 만드는 일은 앱 handler의 몫이다.

// command.revert가 지원하는 write의 성공 결과.

// 호출에 붙이는 confirm proof는 core가 서명한 envelope다.
// 서명 없는 payload는 받지 않는다.

// bundle 내부 path. traversal·scheme·authority는 거절한다.

// release 없는 preview(준비 전 bundle)는 null이다. live 자식은 null이면 release 불일치로 거절한다.
// 화면 view가 닫히거나 교체됐다는 사실. 앱 프로세스가 그 view_session을 버리고 다시 열지 않는다.
