import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/health";

/** What this backend allows, from /healthz. `publicMode`: a visitor-facing instance where demo
 * reset and Escape Room runs are refused by the backend; the UI hides those controls. */
export function useDeployment(): { demoMode: boolean; publicMode: boolean } {
  const health = useQuery({ queryKey: ["healthz"], queryFn: ({ signal }) => getHealth(signal), staleTime: 60_000 });
  return { demoMode: !!health.data?.demo_mode, publicMode: !!health.data?.public_mode };
}
