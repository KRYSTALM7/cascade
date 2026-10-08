import { useQuery } from "@tanstack/react-query";
import { api } from "../api/endpoints";
import type { ConsequenceReport } from "../api/types";
import { inr } from "../lib/format";

interface Row {
  label: string;
  before: string;
  preview: string;
  now: string;
}

function show(value: unknown, money = false): string {
  if (value === null || value === undefined) return "—";
  return money ? inr(String(value)) : String(value);
}

/** Before → previewed after (from the report) → live value now (from the database). */
export function OrderState({ orderId, report }: { orderId: string; report: ConsequenceReport }) {
  const order = useQuery({ queryKey: ["order", orderId], queryFn: () => api.order(orderId) });
  const changes = report.nodes.filter((n) => n.status === "WILL_EXECUTE").flatMap((n) => n.changes);
  const find = (type: string, field: string) => changes.find((c) => c.resource_type === type && c.field === field);
  const live = order.data;
  const payment = live?.payments[0];

  const rows: Row[] = [];
  const status = find("order", "status");
  rows.push({
    label: "Order status",
    before: show(status?.before ?? live?.status),
    preview: show(status?.after ?? live?.status),
    now: show(live?.status),
  });
  const total = find("order", "total_amount");
  if (total) rows.push({ label: "Order total", before: show(total.before, true), preview: show(total.after, true), now: show(live?.total_amount, true) });
  if (payment) {
    const refunded = find("payment", "refunded_amount");
    const pStatus = find("payment", "status");
    rows.push({
      label: `Payment ${payment.id}`,
      before: show(pStatus?.before ?? payment.status),
      preview: show(pStatus?.after ?? pStatus?.before ?? payment.status),
      now: show(payment.status),
    });
    rows.push({
      label: "Refunded",
      before: show(refunded?.before ?? payment.refunded_amount, true),
      preview: show(refunded?.after ?? refunded?.before ?? payment.refunded_amount, true),
      now: show(payment.refunded_amount, true),
    });
  }
  const customer = find("customer", "status");
  if (customer) rows.push({ label: "Customer", before: show(customer.before), preview: show(customer.after), now: show(live?.customer.status) });

  return (
    <section aria-label="Order state" className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <h3 className="text-sm font-semibold text-slate-300" title={`State version v${live?.version ?? "…"}`}>
        Order {orderId} <span className="font-normal text-slate-500">· before, simulated after, and live in the database now</span>
      </h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="py-1 font-medium" />
            <th className="py-1 font-medium">Before</th>
            <th className="py-1 font-medium">Simulated after</th>
            <th className="py-1 font-medium">Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-800/80">
              <td className="py-1.5 text-slate-400">{r.label}</td>
              <td className="py-1.5 font-mono text-slate-300">{r.before}</td>
              <td className={`py-1.5 font-mono ${r.preview !== r.before ? "text-amber-300" : "text-slate-300"}`}>{r.preview}</td>
              <td data-testid={`now-${r.label}`} className={`py-1.5 font-mono ${r.now === r.preview && r.preview !== r.before ? "text-emerald-300" : "text-slate-300"}`}>
                {r.now}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
