// H/run의 인증 없는 위치 metadata 파일 이름. 쓰는 쪽(core)과 읽는 쪽(client)이 같이 쓴다.
export const RUN_METADATA_NAME = "location.json";

// run 폴더에서 credential이 든 file은 이것 하나다. 그래서 location.json과 따로 둔다.
export const USER_TOKEN_FILE_NAME = "user-token";
