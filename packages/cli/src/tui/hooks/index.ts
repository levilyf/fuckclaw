export interface TUIHookState {
  active: boolean;
}

export function createTUIHookState(active: boolean = true): TUIHookState {
  return { active };
}
