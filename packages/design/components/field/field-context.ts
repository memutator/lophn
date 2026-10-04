import { createContext, useContext } from "react";

export interface FieldContextValue {
  readonly id: string;
  readonly invalid: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

// 입력은 언제나 Field의 보이는 라벨을 가진다. placeholder가 라벨을 대신하지 않는다(shell/design-system#R28).
export function useField(control: string): FieldContextValue {
  const field = useContext(FieldContext);
  if (!field) throw new Error(`${control} needs a Field label`);
  return field;
}
