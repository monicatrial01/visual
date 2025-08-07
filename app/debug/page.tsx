"use client"

import DiagnosticsPanel from "@/components/diagnostics-panel"

export default function DebugPage() {
  return (
    <main className="min-h-[100dvh] bg-white">
      <div className="p-6">
        <h1 className="text-2xl font-bold">{"Painel de Diagnóstico"}</h1>
        <p className="text-zinc-600 mt-2 text-sm">
          {"Use este painel para checar compatibilidade, conectividade e capturar erros do console. Abra em dispositivos diferentes para comparar."}
        </p>
      </div>
      <DiagnosticsPanel />
    </main>
  )
}
