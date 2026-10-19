import { createContext, useContext } from "react";

// detached 창에는 floats 층이 없다. browser 탭이 DevTools 자리 menu에서 floated를 빼는 데 쓴다.
const DetachedWindowContext = createContext(false);

export const DetachedWindowProvider = DetachedWindowContext.Provider;

export function useInDetachedWindow(): boolean {
  return useContext(DetachedWindowContext);
}
