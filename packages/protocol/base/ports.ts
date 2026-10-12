declare const portType: unique symbol;

// key의 object identity로 구현을 구별하고 phantom type으로 잘못된 주입을 막는다.
export type PortKey<T> = {
  readonly name: string;
  readonly [portType]?: (value: T) => T;
};

export function definePort<T>(name: string): PortKey<T> {
  if (!name) throw new Error("port name must not be empty");
  return Object.freeze({ name });
}
