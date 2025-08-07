"use client"

import { useEffect, useState } from "react"
import { getTransportKind, type TransportKind } from "@/lib/realtime"
import { cn } from "@/lib/utils"

export default function TransportBadge() {
  const [kind, setKind] = useState<TransportKind>(() => getTransportKind())

  // Kind normalmente não muda em runtime, mas deixamos um fallback leve
  useEffect(() => {
    const id = setInterval(() => setKind(getTransportKind()), 1500)
    return () => clearInterval(id)
  }, [])

  const label =
    kind === "supabase" ? "Supabase Realtime"
    : kind === "broadcast" ? "BroadcastChannel"
    : "localStorage"

  const dot =
    kind === "supabase" ? "bg-emerald-500"
    : kind === "broadcast" ? "bg-sky-500"
    : "bg-amber-500"

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs shadow-sm",
        "bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70"
      )}
      aria-label={`Transporte em uso: ${label}`}
      title={`Transporte em uso: ${label}`}
    >
      <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
      <span className="font-medium">{label}</span>
    </div>
  )
}
