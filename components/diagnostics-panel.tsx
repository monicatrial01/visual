"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { getTransportKind, type TransportKind } from "@/lib/realtime"
import { cn } from "@/lib/utils"
import { Bug, Copy, HardDrive, Link2, Loader2, MonitorSmartphone, RefreshCw, UserPlus } from 'lucide-react'
import { getSupabaseClient } from "@/lib/supabase-client"

type CheckResult = {
  id: string
  label: string
  ok: boolean | null
  info?: string
  error?: string
}

export default function DiagnosticsPanel() {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [transport, setTransport] = useState<TransportKind>(() => getTransportKind())
  const [results, setResults] = useState<CheckResult[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [ua, setUa] = useState("")
  const [viewport, setViewport] = useState<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 })
  const [envStatus, setEnvStatus] = useState<{ hasUrl: boolean | null; hasAnon: boolean | null; urlHost: string | null }>({ hasUrl: null, hasAnon: null, urlHost: null })
  const [envLoading, setEnvLoading] = useState(false)

  // Capture console and unhandled errors
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      setLogs((l) => [...l, `[Error] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`].slice(-200))
    }
    const onRej = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason)
      setLogs((l) => [...l, `[UnhandledRejection] ${msg}`].slice(-200))
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRej)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRej)
    }
  }, [])

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 })
    onResize()
    window.addEventListener("resize", onResize)
    setUa(navigator.userAgent)
    const id = setInterval(() => setTransport(getTransportKind()), 1500)
    return () => {
      window.removeEventListener("resize", onResize)
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    loadEnvStatus()
  }, [])

  async function loadEnvStatus() {
    try {
      setEnvLoading(true)
      const res = await fetch('/api/public-env', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load env status')
      const data = await res.json()
      setEnvStatus({
        hasUrl: !!data.hasUrl,
        hasAnon: !!data.hasAnon,
        urlHost: data.urlHost || null,
      })
    } catch {
      setEnvStatus({ hasUrl: null, hasAnon: null, urlHost: null })
    } finally {
      setEnvLoading(false)
    }
  }

  async function runChecks() {
    setRunning(true)
    const out: CheckResult[] = []

    out.push({
      id: "transport",
      label: "Transporte ativo",
      ok: true,
      info: transport === "supabase" ? "Supabase Realtime" : transport === "broadcast" ? "BroadcastChannel" : "localStorage",
    })

    out.push({
      id: "broadcast",
      label: "BroadcastChannel suportado",
      ok: typeof window !== "undefined" && "BroadcastChannel" in window,
      info: "Fallback automático para localStorage quando indisponível",
    })

    out.push({
      id: "localstorage",
      label: "localStorage disponível",
      ok: testLocalStorageAvailable(),
      info: "Requer abas/janelas distintas para eventos 'storage'",
    })

    out.push({
      id: "websocket",
      label: "WebSocket disponível",
      ok: typeof window !== "undefined" && "WebSocket" in window,
    })

    const camPerm = await queryPerm("camera")
    const micPerm = await queryPerm("microphone")
    out.push({ id: "perm_cam", label: "Permissão de câmera (estado)", ok: camPerm.ok, info: camPerm.info })
    out.push({ id: "perm_mic", label: "Permissão de microfone (estado)", ok: micPerm.ok, info: micPerm.info })

    const supa = getSupabaseClient()
    if (supa) {
      const res = await testSupabaseRealtime()
      out.push({ id: "supabase", label: "Conexão Supabase Realtime", ok: res.ok, info: res.info, error: res.error })
    } else {
      out.push({
        id: "supabase",
        label: "Conexão Supabase Realtime",
        ok: false,
        info: "NEXT_PUBLIC_SUPABASE_URL/ANON_KEY não configuradas. Defina no Vercel e redeploy.",
      })
    }

    setResults(out)
    setRunning(false)
  }

  function testLocalStorageAvailable() {
    try {
      const k = "__vm_diag__" + Math.random().toString(16).slice(2)
      localStorage.setItem(k, "1")
      localStorage.removeItem(k)
      return true
    } catch {
      return false
    }
  }

  async function queryPerm(name: "camera" | "microphone"): Promise<{ ok: boolean | null; info: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perms: any = (navigator as any).permissions
      if (!perms?.query) return { ok: null, info: "Indisponível" }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status: any = await perms.query({ name } as any)
      return { ok: status.state === "granted", info: status.state }
    } catch {
      return { ok: null, info: "Indisponível" }
    }
  }

  async function testSupabaseRealtime(): Promise<{ ok: boolean; info: string; error?: string }> {
    try {
      const supa = getSupabaseClient()
      if (!supa) return { ok: false, info: "Cliente não configurado" }
      const chKey = "vm_diag_" + Math.random().toString(16).slice(2)
      const ch = supa.channel(chKey, { config: { broadcast: { self: true } } })
      let subscribed = false
      let gotEcho = false

      await new Promise<void>((resolve) => {
        ch.on("system", { event: "phx_reply" }, () => {}).subscribe((status) => {
          if (status === "SUBSCRIBED") {
            subscribed = true
            resolve()
          }
        })
      })

      if (!subscribed) return { ok: false, info: "Falha ao inscrever no canal" }

      await new Promise<void>((resolve) => {
        ch.on("broadcast", { event: "diag" }, (payload) => {
          if (payload?.payload?.ping === chKey) {
            gotEcho = true
            resolve()
          }
        })
        ch.send({ type: "broadcast", event: "diag", payload: { ping: chKey, t: Date.now() } })
        setTimeout(() => resolve(), 1800)
      })

      try {
        ch.unsubscribe()
      } catch {}
      if (gotEcho) return { ok: true, info: "Canal ativo e recebendo mensagens" }
      return { ok: false, info: "Sem eco de broadcast (verifique firewall/rede)" }
    } catch (e: any) {
      return { ok: false, info: "Exceção durante teste", error: e?.message || String(e) }
    }
  }

  function clearCaches() {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("vm_") || k.includes("vm_room_")) localStorage.removeItem(k as string)
      })
    } catch {}
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})
    }
  }

  function hardReload() {
    const u = new URL(window.location.href)
    u.searchParams.set("nocache", Date.now().toString())
    window.location.replace(u.toString())
  }

  function copyLogs() {
    const blob = [
      `UA: ${ua}`,
      `Viewport: ${viewport.w}x${viewport.h} @ DPR ${viewport.dpr}`,
      `Transport: ${transport}`,
      "",
      "Checks:",
      ...results.map((r) => `- ${r.label}: ${r.ok === null ? "N/A" : r.ok ? "OK" : "Falha"} ${r.info ? `(${r.info})` : ""} ${r.error ? `Err: ${r.error}` : ""}`),
      "",
      "Console:",
      ...logs,
    ].join("\n")
    navigator.clipboard.writeText(blob).catch(() => {})
  }

  const Dot = ({ ok }: { ok: boolean | null }) => {
    const color = ok === null ? "bg-zinc-400" : ok ? "bg-emerald-500" : "bg-red-500"
    return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", color)} aria-hidden />
  }

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button className="shadow-md" variant="outline">
            <Bug className="mr-2 h-4 w-4 text-amber-600" />
            {"Diagnóstico"}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[360px] sm:w-[420px] p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="flex items-center justify-between gap-2">
              <span>{"Diagnóstico de Compatibilidade"}</span>
              <span className="inline-flex items-center gap-2 text-xs text-zinc-600">
                <Dot ok={transport === "supabase" ? true : transport === "broadcast" ? true : false} />
                {transport === "supabase" ? "Supabase Realtime" : transport === "broadcast" ? "BroadcastChannel" : "localStorage"}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="p-4 space-y-4">
            <Card className="p-3">
              <div className="text-sm">
                <div className="font-medium flex items-center gap-2">
                  <MonitorSmartphone className="h-4 w-4 text-sky-600" />
                  {"Ambiente"}
                </div>
                <div className="mt-2 space-y-1 text-xs text-zinc-700 break-all">
                  <div>{"UA: "}{ua}</div>
                  <div>{"Viewport: "}{viewport.w}{" x "}{viewport.h}{" @ DPR "}{viewport.dpr}</div>
                </div>
              </div>
            </Card>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={runChecks} disabled={running} className="bg-emerald-600 hover:bg-emerald-700">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {"Executar testes"}
              </Button>
              <Button size="sm" variant="outline" onClick={clearCaches}>
                <HardDrive className="mr-2 h-4 w-4" />
                {"Limpar cache/localStorage"}
              </Button>
              <Button size="sm" variant="outline" onClick={hardReload}>
                <Link2 className="mr-2 h-4 w-4" />
                {"Hard reload"}
              </Button>
            </div>

            <Card className="p-3">
              <div className="text-sm font-medium mb-2">{"Variáveis de ambiente (servidor do deploy)"}</div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Dot ok={envStatus.hasUrl === null ? null : envStatus.hasUrl} />
                  <div className="min-w-0">
                    <div className="font-medium">{"NEXT_PUBLIC_SUPABASE_URL"}</div>
                    <div className="text-xs text-zinc-600">
                      {envStatus.hasUrl === null
                        ? "Indisponível (erro ao consultar)."
                        : envStatus.hasUrl
                          ? `Detectada${envStatus.urlHost ? ` (${envStatus.urlHost})` : ""}`
                          : "Não configurada no deploy."}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Dot ok={envStatus.hasAnon === null ? null : envStatus.hasAnon} />
                  <div className="min-w-0">
                    <div className="font-medium">{"NEXT_PUBLIC_SUPABASE_ANON_KEY"}</div>
                    <div className="text-xs text-zinc-600">
                      {envStatus.hasAnon === null
                        ? "Indisponível (erro ao consultar)."
                        : envStatus.hasAnon
                          ? "Detectada"
                          : "Não configurada no deploy."}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={loadEnvStatus} disabled={envLoading}>
                  {envLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {"Recarregar estado"}
                </Button>
                <Button size="sm" asChild className="bg-sky-600 hover:bg-sky-700">
                  <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">{"Abrir Vercel Dashboard"}</a>
                </Button>
              </div>
              <div className="mt-2 text-[11px] text-zinc-500">
                {"Se as variáveis aparecem como 'Detectada(s)', crie um novo deploy para que o cliente receba os valores atualizados."}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-sm font-medium mb-2">{"Teste rápido entre dispositivos"}</div>
              <p className="text-xs text-zinc-600 mb-3">
                {"Com as variáveis NEXT_PUBLIC_SUPABASE_* configuradas no Vercel, abra uma sala e compartilhe o link em outro dispositivo."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="bg-sky-600 hover:bg-sky-700" asChild>
                  <a href={`/room/demo?name=${encodeURIComponent("Sala Demo")}&theme=meeting`} aria-label="Abrir sala demo para teste">
                    <UserPlus className="mr-2 h-4 w-4" />
                    {"Abrir sala demo"}
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/room/demo?name=Sala%20Demo&theme=meeting#instrucoes" aria-label="Copiar link e abrir em outro dispositivo">
                    {"Copiar/compartilhar o link"}
                  </a>
                </Button>
              </div>
              <Separator className="my-3" />
              <div className="text-[11px] text-zinc-500">
                {"O badge no topo da sala deve mostrar 'Supabase Realtime'. Caso contrário, verifique as variáveis e faça redeploy."}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-sm font-medium mb-2">{"Resultados"}</div>
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 text-sm">
                    <Dot ok={r.ok} />
                    <div className="min-w-0">
                      <div className="font-medium">{r.label}</div>
                      {(r.info || r.error) && (
                        <div className={cn("text-xs", r.ok === false ? "text-red-600" : "text-zinc-600")}>
                          {r.info}
                          {r.error ? (" · " + r.error) : ""}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {results.length === 0 && <div className="text-xs text-zinc-500">{"Clique em Executar testes"}</div>}
              </div>
            </Card>

            <Card className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{"Erros do console (ao vivo)"}</div>
                <Button size="icon" variant="ghost" onClick={copyLogs} title="Copiar logs"> <Copy className="h-4 w-4" /> </Button>
              </div>
              <ScrollArea className="h-40 mt-2 rounded border bg-zinc-50 p-2">
                <div className="space-y-1 text-xs text-zinc-700">
                  {logs.length === 0 ? <div className="text-zinc-500">{"Sem erros capturados ainda."}</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </ScrollArea>
              <div className="mt-2 text-[11px] text-zinc-500">{"Erros capturados por window.onerror e unhandledrejection."}</div>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      {/* Botão flutuante extra para mobile */}
      <Button variant="outline" className="mt-2 shadow-md sm:hidden" onClick={() => setOpen(true)}>
        <Bug className="mr-2 h-4 w-4 text-amber-600" />
        {"Diagnóstico"}
      </Button>
    </div>
  )
}
