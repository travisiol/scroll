import type { Metadata } from "next";
import { AppShell, SignInGate } from "@/components/app/AppShell";
import { currentSession } from "@/server/session";

export const metadata: Metadata = { title: "Review", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) {
    return (
      <AppShell area="admin" address={null} isAdmin={false}>
        <SignInGate returnTo="/admin" title="Reviewer sign-in" admin />
      </AppShell>
    );
  }
  return (
    <AppShell area="admin" address={session.isAdmin ? session.address : null} isAdmin={session.isAdmin}>
      {session.isAdmin ? (
        children
      ) : (
        <div className="card card-pad mx-auto mt-6 max-w-xl text-center">
          <h1 className="text-3xl">Not a reviewer wallet</h1>
          <p className="mt-3 leading-relaxed text-muted">
            <span className="num">{session.address}</span> isn&rsquo;t on the reviewer list. The list is the <span className="num">ADMIN_WALLETS</span> setting on the server: add this address there and restart to review with it. Nothing on this page can change it.
          </p>
          <a href="/app" className="btn btn-dark mt-6">
            Go to my account
          </a>
        </div>
      )}
    </AppShell>
  );
}
