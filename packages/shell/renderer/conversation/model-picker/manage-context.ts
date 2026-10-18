import { createContext, useContext } from "react";

export interface ManageModelsApi {
  /** Manage models 창을 연다. */
  open(): void;
}

/** 창을 여는 host가 감싼다. null이면(host 밖, 기본 model 대화창 안) picker에 Manage models 줄이 없다. */
export const ManageModelsContext = createContext<ManageModelsApi | null>(null);

export function useManageModels(): ManageModelsApi | null {
  return useContext(ManageModelsContext);
}
