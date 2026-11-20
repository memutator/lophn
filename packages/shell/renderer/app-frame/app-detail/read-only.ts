// 다른 컴퓨터의 App details는 읽기만 한다. 쓰는 단추(이름, 보관, 실행, icon, 폴더, 돌아가기, 거두기, secret, rewind)는
// 이 context가 true이면 그리지 않는다. 쓰는 route는 기기의 목록에 없거나 이 컴퓨터의 창(OS 선택기, 보호 입력)을 거치기 때문이다.
import { createContext, useContext } from "react";

const ReadOnlyContext = createContext(false);

export const ReadOnlyProvider = ReadOnlyContext.Provider;

export const useReadOnly = (): boolean => useContext(ReadOnlyContext);
