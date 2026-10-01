"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { shortAddress } from "@/lib/format";
import { useAuth } from "../auth";
import { Logo } from "../Logo";

const USER_NAV = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/upload", label: "Upload" },
  { href: "/app/rewards", label: "Rewards" },
  { href: "/app/settings", label: "Settings" },
];

const ADMIN_NAV = [
  { href: "/admin", label: "Review" },
  { href: "/admin/policy", label: "Policy" },
  { href: "/admin/pools", label: "Pools" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/network", label: "Network" },
  { href: "/admin/audit", label: "Audit" },
];

export function AppShell({ area, address, isAdmin, children }: { area: "app" | "admin"; address: string | null; isAdmin: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const nav = area === "admin" ? ADMIN_NAV : USER_NAV;
  const root = area === "admin" ? "/admin" : "/app";
  const active = (href: string) => (href === root ? pathname === root || pathname.startsWith(`${root}/submissions`) : pathname.startsWith(href));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-page/95 backdrop-blur-sm">
        <div className="shell flex h-16 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="SCROLL home" className="rounded-lg">
              <Logo size={28} id="app" />
            </Link>
            {area === "admin" && <span className="pill pill-action">Reviewer</span>}
          </div>
          {address && (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Link href={area === "admin" ? "/app" : "/admin"} className="btn btn-quiet btn-sm">
                  {area === "admin" ? "My account" : "Admin"}
                </Link>
              )}
              <span className="num hidden text-sm text-muted sm:inline">{shortAddress(address)}</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => signOut()}>
                Sign out
              </button>
            </div>
          )}
        </div>
        {address && (
          <nav aria-label={area === "admin" ? "Admin" : "Account"} className="shell -mb-px flex gap-1 overflow-x-auto">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[0.975rem] font-semibold transition-colors ${active(n.href) ? "border-pink text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className="shell py-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}

/** Shown in place of any account page when there is no verified session. */
export function SignInGate({ returnTo, title = "Sign in to continue", admin = false }: { returnTo: string; title?: string; admin?: boolean }) {
  const { openSignIn, loading } = useAuth();
  return (
    <div className="card card-pad mx-auto mt-6 max-w-xl text-center">
      <h1 className="text-3xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted">
        {admin
          ? "The review area is for SCROLL reviewers. Sign in with a wallet on the reviewer list."
          : "Connect your wallet and sign one free message. That's your account: no email, no password, no spending approvals."}
      </p>
      <button type="button" className="btn btn-primary mt-6" disabled={loading} onClick={() => openSignIn(returnTo)}>
        Connect wallet
      </button>
    </div>
  );
}
