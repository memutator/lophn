// session rewind 읽기(rewind/preview·checkpoints·list)의 reader Worker 등록이다(lophn-agent/revert).
// preview는 지금의 파일을 읽어 판정하므로 동기 file API가 필요하다. 이 모듈은 core가 정적으로 import하지
// 않는다(createReaderRegistration만 reader Worker가 부른다). 동기 file API는 reader Worker 안에서만
// 쓴다(core_imports_test). core 쪽 route 등록은 register.ts의 같은 읽기 정의다. 고른 시점 뒤 앱 write 목록의
// AppWrites port는 앱 조립(wiring/rewind-registration.ts)이 reader에 등록한다.

