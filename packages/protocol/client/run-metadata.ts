// H/run의 인증 없는 위치 metadata 파일 이름. 쓰는 쪽(core)과 읽는 쪽(client)이 같이 쓴다.
export const RUN_METADATA_NAME = "location.json";

// H/run의 위치 metadata를 읽는다(daemon status가 쓴다). 파일 이름은
// 고정 상수이고 내용은 schema로 걸러 credential 모양은 애초에 없다. 값 자체를
// log에 그대로 쓰지 않는 것은 호출자의 몫이다.
