import { desc } from "drizzle-orm";
import Link from "next/link";
import { Empty, PageTitle } from "@/components/app/bits";
import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { formatDateTime, shortAddress } from "@/lib/format";
import { currentAdmin } from "@/server/session";

function href(type: string, id: string): string | null {
  if (type === "submission") return `/admin/submissions/${id}`;
  if (type === "policy") return "/admin/policy";
  if (type === "pool") return "/admin/pools";
  if (type === "allocation") return "/admin/payouts";
  if (type === "settings") return "/admin/network";
  return null;
}

export default async function AuditPage() {
  if (!(await currentAdmin())) return null;
  const db = await getDb();
  const events = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(300);

  return (
    <>
      <PageTitle title="Audit history">Every review decision, duration change, policy change, pool movement and payout step, newest first. Written in the same transaction as the change; nothing here can be edited.</PageTitle>
      {events.length === 0 ? (
        <Empty title="No events yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[52rem]">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">On</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const link = href(e.entityType, e.entityId);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</td>
                    <td className="num">{e.actor.startsWith("0x") ? shortAddress(e.actor) : e.actor}</td>
                    <td className="font-semibold">{e.action}</td>
                    <td>
                      {link ? (
                        <Link className="link" href={link}>
                          {e.entityType}
                        </Link>
                      ) : (
                        e.entityType
                      )}
                    </td>
                    <td>
                      <details>
                        <summary className="cursor-pointer text-sm text-muted">Show</summary>
                        <pre className="num mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-blush p-3 text-xs">{JSON.stringify(e.data, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
