"use client";

import Link from "next/link";
import { useState } from "react";
import { shortAddress } from "@/lib/format";
import { useAuth } from "./auth";
import { Logo } from "./Logo";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#rewards", label: "Rewards" },
];

export function WalletButton({ className = "" }: { className?: string }) {
  const { session, loading, openSignIn } = useAuth();
  if (session) {
    return (
      <Link href="/app" className={`btn btn-quiet ${className}`}>
        <span aria-hidden className="size-2 rounded-full bg-good" />
        <span className="num text-[0.95rem]">{shortAddress(session.address)}</span>
        <span className="text-muted max-sm:hidden">· Dashboard</span>
      </Link>
    );
  }
  return (
    <button type="button" className={`btn btn-dark ${className}`} onClick={() => openSignIn()} disabled={loading}>
      Connect wallet
    </button>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-page/90 backdrop-blur-sm">
      <div className="shell flex h-[4.5rem] items-center justify-between gap-4 lg:h-24">
        <Link href="/" aria-label="SCROLL home" className="rounded-lg">
          <Logo size={34} id="hdr" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-10 text-[1.0625rem] font-semibold md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md hover:text-pink transition-colors">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <WalletButton className="max-md:hidden" />
          <button
            type="button"
            className="btn btn-quiet btn-sm md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="shell border-t border-line pb-5 pt-3 md:hidden">
          <ul className="grid gap-1 text-lg font-semibold">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded-xl px-2 py-3" onClick={() => setOpen(false)}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <WalletButton className="mt-3 w-full" />
        </nav>
      )}
    </header>
  );
}

/** The upload call to action: goes straight to the flow, through sign-in first when needed. */
export function UploadCta({ className = "btn btn-primary btn-lg", children = "Upload your screen time" }: { className?: string; children?: React.ReactNode }) {
  const { session, openSignIn } = useAuth();
  if (session) {
    return (
      <Link href="/app/upload" className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={() => openSignIn("/app/upload")}>
      {children}
    </button>
  );
}
