import { createContext, useContext } from "react";

export const DEMO_USERS = [
  { id: "ops-ravi", label: "Ravi · Support Ops (operator)", role: "OPERATOR" },
  { id: "approver-asha", label: "Asha · Finance Lead (approver, ₹100,000)", role: "APPROVER" },
  { id: "approver-dev", label: "Dev · Team Lead (approver, ₹10,000)", role: "APPROVER" },
  { id: "viewer-kim", label: "Kim · Auditor (viewer)", role: "VIEWER" },
] as const;

/** Who proposes the demo scenarios. Approvers never request them, so the flagship can always be
 * approved by somebody else: the backend refuses self-approval, and that rule is not relaxed. */
export const REQUESTER_ID = "ops-ravi";
export const requesterLabel = DEMO_USERS[0].label;

/** The persona a scenario should be proposed as: the current one if it is an operator. */
export function requesterFor(userId: string): string {
  return DEMO_USERS.some((u) => u.id === userId && u.role === "OPERATOR") ? userId : REQUESTER_ID;
}

export interface UserState {
  userId: string;
  setUserId: (id: string) => void;
  /** A one-line explanation of an automatic persona switch (null = nothing to say). */
  notice: string | null;
  setNotice: (notice: string | null) => void;
}

export const UserContext = createContext<UserState>({ userId: "ops-ravi", setUserId: () => {}, notice: null, setNotice: () => {} });

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
