"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sparkles, DoorOpen, Users, Camera, Palette } from 'lucide-react'
import { themePresets, type ThemeKey } from "@/lib/theme-presets"
import Link from "next/link"

export default function HomePage() {
  const router = useRouter()
  const [roomName, setRoomName] = useState("Minha Reunião")
  const [theme, setTheme] = useState<ThemeKey>("meeting")
  const [displayName, setDisplayName] = useState("")
  const [color, setColor] = useState("#7c3aed")

  useEffect(() => {
    try {
      const stored = localStorage.getItem("vm_avatar_profile")
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.name) setDisplayName(parsed.name)
        if (parsed?.color) setColor(parsed.color)
      }
    } catch {}
  }, [])

  const themeOpts = useMemo(() => Object.entries(themePresets) as [ThemeKey, (typeof themePresets)[ThemeKey]][], [])

  function handleCreate() {
    const id = crypto.randomUUID().slice(0, 8)
    const params = new URLSearchParams()
    params.set("name", encodeURIComponent(roomName || "Sala"))
    params.set("theme", theme)
    router.push(`/room/${id}?${params.toString()}`)
  }

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-white text-zinc-900">
      <div className="mx-auto max-w-6xl p-6 md:p-10">
        <header className="mb-8">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight flex items-center gap-3">
            <Sparkles className="h-8 w-8 md:h-10 md:w-10 text-fuchsia-500" />
            {"Meet Pixel: Reuniões Imersivas"}
          </h1>
          <p className="text-zinc-600 mt-2 max-w-2xl">
            {"Crie salas temáticas e interaja com avatares em um espaço virtual dinâmico. Imersão, gamificação e colaboração — estilo Habbo, com foco em produtividade."}
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DoorOpen className="h-5 w-5 text-emerald-600" />
                {"Criar uma sala"}
              </CardTitle>
              <CardDescription>{"Defina um tema e personalize seu avatar."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="roomName">{"Nome da sala"}</Label>
                <Input id="roomName" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Workshop de Design" />
              </div>
              <div className="space-y-2">
                <Label>{"Tema da sala"}</Label>
                <Select value={theme} onValueChange={(v: ThemeKey) => setTheme(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione um tema" />
                  </SelectTrigger>
                  <SelectContent>
                    {themeOpts.map(([key, t]) => (
                      <SelectItem key={key} value={key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Tabs defaultValue="identity" className="pt-2">
                <TabsList>
                  <TabsTrigger value="identity">{"Identidade"}</TabsTrigger>
                  <TabsTrigger value="camera">{"Câmera"}</TabsTrigger>
                </TabsList>
                <TabsContent value="identity" className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName">{"Seu nome"}</Label>
                    <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ana Clara" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="color" className="flex items-center gap-2">
                      <Palette className="h-4 w-4 text-violet-600" />
                      {"Cor do avatar"}
                    </Label>
                    <div className="flex items-center gap-3">
                      <input
                        id="color"
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        aria-label="Cor do avatar"
                        className="h-10 w-14 cursor-pointer rounded border"
                      />
                      <div className="text-sm text-zinc-600">
                        {color}
                      </div>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="camera" className="pt-4">
                  <p className="text-sm text-zinc-600 flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    {"Habilite a câmera dentro da sala para refletir sua imagem no rosto do avatar."}
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
            <CardFooter className="flex items-center justify-between">
              <div className="text-xs text-zinc-500 flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                {"Compartilhe o link da sala com seu time."}
              </div>
              <Button onClick={handleCreate} className="bg-fuchsia-600 hover:bg-fuchsia-700">
                {"Criar sala"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-sky-600" />
                {"Como funciona"}
              </CardTitle>
              <CardDescription>{"Imersão, interação e diversão"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-zinc-700">
              <ul className="list-disc pl-5 space-y-2">
                <li>{"Avatares móveis: use as setas ou WASD para navegar pelo espaço."}</li>
                <li>{"Rosto dinâmico: sua câmera aparece como um rosto circular com leve parallax."}</li>
                <li>{"Chat em tempo real: mensagens no painel e balões acima do avatar."}</li>
                <li>{"Salas temáticas: escolha entre reunião, workshop, lounge, feira e jogos."}</li>
                <li>{"Demo local: abra a mesma sala em múltiplas abas para testar multiusuário."}</li>
              </ul>
              <div className="rounded-lg border p-3 bg-zinc-50">
                <p className="font-medium">{"Quer apenas experimentar?"}</p>
                <p className="text-xs text-zinc-600 mt-1">
                  {"Use a sala demo: "}
                  <Link prefetch={false} href={`/room/demo?name=${encodeURIComponent("Sala Demo")}&theme=meeting`} className="text-sky-700 underline">
                    {"/room/demo"}
                  </Link>
                </p>
              </div>
            </CardContent>
            <CardFooter />
          </Card>
        </div>
      </div>
    </main>
  )
}
