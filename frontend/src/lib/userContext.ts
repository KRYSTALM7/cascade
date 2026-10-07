import { createContext, useContext } from "react";

export const DEMO_USERS = [
  { id: "ops-ravi", label: "Ravi · Support Ops (operator)" },
  { id: "approver-asha", label: "Asha · Finance Lead (approver, ₹1,00,000)" },
  { id: "approver-dev", label: "Dev · Team Lead (approver, ₹10,000)" },
  { id: "viewer-kim", label: "Kim · Auditor (viewer)" },
] as const;

export interface UserState {
  userId: string;
  setUserId: (id: string) => void;
}

export const UserContext = createContext<UserState>({ userId: "ops-ravi", setUserId: () => {} });

export const useUser = () => useContext(UserContext);

const KEY = "cascade.user";

export function loadUser(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "ops-ravi";
  } catch {
    return "ops-ravi";
  }
}

export function saveUser(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* private mode: per-tab only */
  }
}
