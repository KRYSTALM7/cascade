import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/endpoints";
import type { ActionDetail, ActionOut } from "../api/types";
import { requesterFor, requesterLabel, useUser } from "./userContext";

/** Parse natural language, then simulate if the backend could resolve it (else return the clarification). */
export async function parseAndSimulate(userId: string, agentId: string, text: string): Promise<ActionDetail> {
  const parsed = await api.parse(userId, agentId, text);
  return parsed.action.status === "PARSED" ? api.simulateAction(userId, parsed.action.id) : parsed;
}

/** Propose the same request again as a NEW action (the old one is terminal: expired, rejected, …). */
export function proposeAgain(userId: string, action: ActionOut): Promise<ActionDetail> {
  if (action.raw_text) return parseAndSimulate(userId, action.agent_id, action.raw_text);
  if (!action.tool_id) throw new Error("This action has nothing to re-simulate.");
  return api.simulateStructured(userId, action.agent_id, action.tool_id, action.parameters);
}

/** Show an action on the Simulate page (seeds the cache, refreshes lists, updates the URL). */
export function useShowAction() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (d: ActionDetail) => {
    queryClient.setQueryData(["action", d.action.id], d);
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
    void navigate(`/simulate?action=${d.action.id}`);
  };
}

/** The persona to propose a scenario as. Approvers (and viewers) never request scenarios: if one
 * is selected, switch to the requester first and say so, so that a different approver can always
 * decide. The backend's self-approval refusal is untouched; this only picks who asks. */
export function useAsRequester() {
  const { userId, setUserId, setNotice } = useUser();
  return (): string => {
    const requester = requesterFor(userId);
    if (requester !== userId) {
      setUserId(requester);
      setNotice(`Proposed as ${requesterLabel}: an approver can't approve a request they made, so the requester proposes and you can switch back to approve.`);
    }
    return requester;
  };
}

/** "Simulate again": a fresh proposal of the same request, by the requester, shown on success. */
export function useProposeAgain(action: ActionOut) {
  const asRequester = useAsRequester();
  const show = useShowAction();
  return useMutation({ mutationFn: () => proposeAgain(asRequester(), action), onSuccess: show });
}

/** DEMO_MODE re-seed. With an action, the same request is proposed again (by the requester). */
export function useResetDemo() {
  const asRequester = useAsRequester();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const show = useShowAction();
  return useMutation({
    mutationFn: async (replay?: ActionOut) => {
      await api.reset();
      queryClient.clear();
      return replay ? proposeAgain(asRequester(), replay) : null;
    },
    onSuccess: (detail) => (detail ? show(detail) : void navigate("/simulate")),
  });
}
