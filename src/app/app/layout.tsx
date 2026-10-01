import type { Metadata } from "next";
import { AppShell, SignInGate } from "@/components/app/AppShell";
import { currentSession } from "@/server/session";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  return (
    <AppShell area="app" address={session?.address ?? null} isAdmin={session?.isAdmin ?? false}>
      {session ? children : <SignInGate returnTo="/app" />}
    </AppShell>
  );
}
