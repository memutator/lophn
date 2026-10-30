// projects가 바깥에서 받는 것들이다. 구현은 main/daemon/wiring이 끼운다.

// 등록 폴더가 디스크에 있는지 본다. 순수 함수가 못하므로 port다.
export interface FolderResolver {
  exists(folderPath: string): boolean;
}
