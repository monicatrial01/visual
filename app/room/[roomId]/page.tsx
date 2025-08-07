"use client"

import { useSearchParams } from "next/navigation"
import VirtualRoom from "@/components/virtual-room"
import DiagnosticsPanel from "@/components/diagnostics-panel"
import { type ThemeKey } from "@/lib/theme-presets"

export default function RoomPage({
  params,
}: {
  params: { roomId: string }
}) {
  const sp = useSearchParams()
  const name = sp.get("name") ? decodeURIComponent(sp.get("name") as string) : "Sala"
  const theme = (sp.get("theme") as ThemeKey) || "meeting"
  return (
    <>
      <VirtualRoom roomId={params.roomId || "demo"} roomName={name} theme={theme} />
      <DiagnosticsPanel />
    </>
  )
}
