"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "../auth";

export function SessionControls() {
  const { signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function everywhere() {
    setBusy(true);
    await api("/api/auth/logout-all", { method: "POST" }).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mt-5 flex flex-wrap gap-2.5">
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => signOut()}>
        Sign out
      </button>
      <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={everywhere}>
        Sign out on every device
      </button>
    </div>
  );
}
