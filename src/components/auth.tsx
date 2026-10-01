"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { WagmiProvider, useConnect, useConnection, useConnectors, useDisconnect, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { SIGN_IN_STATEMENT } from "@/config/brand";
import { CHAIN } from "@/config/network";
import { api, errorMessage } from "@/lib/api";
import { nowMs, shortAddress } from "@/lib/format";
import { wagmiConfig } from "@/lib/wagmi";

export interface Session {
  address: string;
  isAdmin: boolean;
}

interface Me {
  session: Session | null;
}

interface AuthValue {
  session: Session | null;
  loading: boolean;
  /** Open the sign-in dialog. After signing in, go to `returnTo` if given. */
  openSignIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <Providers>");
  return value;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const { address, isConnected } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const [dialog, setDialog] = useState<{ open: boolean; returnTo?: string; notice?: string }>({ open: false });

  const session = me.data?.session ?? null;

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    disconnect();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    router.refresh();
  }, [disconnect, queryClient, router]);

  // The wallet switched accounts while signed in: the old session no longer matches who is here.
  const sessionAddress = session?.address ?? null;
  useEffect(() => {
    if (!sessionAddress || !isConnected || !address) return;
    if (address.toLowerCase() === sessionAddress) return;
    let cancelled = false;
    api("/api/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        router.refresh();
        setDialog({ open: true, notice: `Your wallet switched to ${shortAddress(address)}, so you were signed out. Sign in again to continue with this wallet.` });
      });
    return () => {
      cancelled = true;
    };
  }, [address, isConnected, sessionAddress, queryClient, router]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading: me.isPending,
      openSignIn: (returnTo) => setDialog({ open: true, returnTo }),
      signOut,
    }),
    [session, me.isPending, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialog.open && (
        <SignInDialog
          notice={dialog.notice}
          onClose={() => setDialog({ open: false })}
          onSignedIn={async () => {
            const returnTo = dialog.returnTo;
            setDialog({ open: false });
            await queryClient.invalidateQueries({ queryKey: ["me"] });
            // Same page: re-render it with the new session. Another page: go there.
            if (returnTo && returnTo !== window.location.pathname) router.push(returnTo);
            router.refresh();
          }}
        />
      )}
    </AuthContext.Provider>
  );
}

function isRejection(error: unknown): boolean {
  const e = error as { code?: number; name?: string; cause?: { code?: number; name?: string } };
  return e?.code === 4001 || e?.name === "UserRejectedRequestError" || e?.cause?.code === 4001 || e?.cause?.name === "UserRejectedRequestError";
}

function SignInDialog({ notice, onClose, onSignedIn }: { notice?: string; onClose: () => void; onSignedIn: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { address, chainId, isConnected } = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: signMessage } = useSignMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  // EIP-6963 wallets announce themselves by name; hide the generic "Injected" entry when they do.
  const wallets = connectors.filter((c) => c.type === "injected");
  const named = wallets.filter((c) => c.id !== "injected");
  const list = named.length ? named : wallets;

  async function pick(uid: string) {
    const connector = connectors.find((c) => c.uid === uid);
    if (!connector) return;
    setBusy(uid);
    setError(null);
    try {
      await connect({ connector });
    } catch (e) {
      setError(isRejection(e) ? "You closed the wallet request. Nothing was connected." : "That wallet didn't respond. Make sure it is installed and unlocked, then try again.");
    } finally {
      setBusy(null);
    }
  }

  async function sign() {
    if (!address) return;
    setBusy("sign");
    setError(null);
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
      const issuedAt = new Date(nowMs());
      const message = createSiweMessage({
        address,
        chainId: chainId ?? CHAIN.id,
        domain: window.location.host,
        uri: window.location.origin,
        version: "1",
        nonce,
        statement: SIGN_IN_STATEMENT,
        issuedAt,
        expirationTime: new Date(issuedAt.getTime() + 5 * 60 * 1000),
      });
      const signature = await signMessage({ message });
      await api("/api/auth/verify", { method: "POST", body: { message, signature } });
      onSignedIn();
    } catch (e) {
      setError(isRejection(e) ? "You declined the signature, so you aren't signed in. Nothing was changed." : errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="signin-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-[1.75rem] border border-line bg-card p-0 text-ink shadow-lift"
    >
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h2 id="signin-title" className="text-3xl">
            {isConnected ? "One signature to sign in" : "Connect your wallet"}
          </h2>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => ref.current?.close()} aria-label="Close">
            Close
          </button>
        </div>

        {notice && <p className="notice mt-5">{notice}</p>}

        {!isConnected ? (
          <div className="mt-5">
            <p className="text-muted leading-relaxed">Your wallet is your SCROLL account, and where rewards are sent. Choose the wallet you want to use.</p>
            <ul className="mt-5 grid gap-2.5">
              {list.map((c) => (
                <li key={c.uid}>
                  <button type="button" className="choice items-center" disabled={busy !== null} onClick={() => pick(c.uid)}>
                    {c.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI
                      <img src={c.icon} alt="" width={28} height={28} className="rounded-md" />
                    ) : (
                      <span aria-hidden className="size-7 rounded-md bg-blush" />
                    )}
                    <span className="font-semibold">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                    <span className="ml-auto text-sm text-muted">{busy === c.uid ? "Waiting…" : "Connect"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && (
              <p className="notice mt-4">No wallet was found in this browser. Install a wallet extension, or open this page in your wallet app&rsquo;s browser, then reload.</p>
            )}
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-muted leading-relaxed">
              Connected as <span className="num text-ink">{address ? shortAddress(address) : ""}</span>. Connecting only shows us an address. To prove it&rsquo;s yours, sign a short message.
            </p>
            <ul className="mt-4 grid gap-2 text-[0.95rem] leading-relaxed">
              <li>• It&rsquo;s free. No transaction is sent and no gas is spent.</li>
              <li>• It can&rsquo;t move funds or approve any spending.</li>
              <li>• The message names this site and expires in five minutes.</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={sign}>
                {busy === "sign" ? "Check your wallet…" : "Sign message"}
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => disconnect()}>
                Use another wallet
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="notice notice-bad mt-5">
            {error}
          </p>
        )}

      </div>
    </dialog>
  );
}
