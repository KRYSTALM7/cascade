import { useState, type ReactNode } from "react";
import { DEMO_USERS, UserContext, loadUser, saveUser, useUser } from "../lib/userContext";

export function UserProvider({ children, initial }: { children: ReactNode; initial?: string }) {
  const [userId, setUser] = useState<string>(() => initial ?? loadUser());
  const [notice, setNotice] = useState<string | null>(null);
  const setUserId = (id: string) => {
    saveUser(id);
    setUser(id);
  };
  return <UserContext.Provider value={{ userId, setUserId, notice, setNotice }}>{children}</UserContext.Provider>;
}

export function UserSwitcher() {
  const { userId, setUserId, setNotice } = useUser();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400">
      <span className="hidden sm:inline">Acting as</span>
      <select
        aria-label="Acting user"
        value={userId}
        onChange={(e) => {
          setNotice(null);
          setUserId(e.target.value);
        }}
        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
      >
        {DEMO_USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
    </label>
  );
}
