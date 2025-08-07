"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { themePresets, type ThemeKey } from "@/lib/theme-presets"
import { useRoomChannel, type BroadcastMessage } from "@/lib/realtime"
import { getDefaultProfile, type AvatarProfile } from "@/lib/avatar"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { cn } from "@/lib/utils"
import { Camera, ChevronLeft, ChevronRight, MessageCircle, Mic, MicOff, Palette, Settings, Users } from 'lucide-react'
import TransportBadge from "@/components/transport-badge"

type VirtualRoomProps = {
  roomId?: string
  roomName?: string
  theme?: ThemeKey
}

type Participant = {
  id: string
  profile: AvatarProfile
  x: number
  y: number
  dir: "up" | "down" | "left" | "right"
  camEnabled: boolean
  micEnabled?: boolean
  speakingLevel?: number // 0..1 smoothed level
  lastSeen: number
}

type WorldObject = {
  id: string
  type: "lamp" | "rug" | "board"
  x: number
  y: number
  w: number
  h: number
  interactive?: boolean
  state?: Record<string, any>
}

const TILE = 64
const WORLD_W = 16
const WORLD_H = 10
const BASE_SPEED = 180 // px/s
const ACCEL = 8
const DECEL = 10
const SEND_RATE_MS = 60
const VOICE_RATE_MS = 140
const LERP_REMOTE = 12

export default function VirtualRoom({
  roomId = "demo",
  roomName = "Sala",
  theme = "meeting",
}: VirtualRoomProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // UI state
  const [camEnabled, setCamEnabled] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const [msg, setMsg] = useState("")
  const [logs, setLogs] = useState<{ id: string; name: string; text: string; ts: number }[]>([])

  const themeConf = themePresets[theme] || themePresets.meeting

  // Profile
  const [profile, setProfile] = useLocalStorage<AvatarProfile>("vm_avatar_profile", getDefaultProfile())
  const myIdRef = useRef<string>("")
  if (!myIdRef.current) myIdRef.current = crypto.randomUUID()

  const channel = useRoomChannel(roomId)

  // Participants UI and refs
  const [participantsUI, setParticipantsUI] = useState<Record<string, Participant>>({})
  const participantsRef = useRef<Record<string, Participant>>({})

  // Local movement/inputs
  const posRef = useRef<{ x: number; y: number }>({
    x: Math.round((WORLD_W * TILE) / 2),
    y: Math.round((WORLD_H * TILE) / 2),
  })
  const velRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const keysRef = useRef<Set<string>>(new Set())
  const targetRef = useRef<{ x: number; y: number } | null>(null)

  // Remote display smoothing
  const displayPosRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  // Pointer smoothing (parallax)
  const rawPointerRef = useRef<{ x: number; y: number } | null>(null)
  const pointerRef = useRef<{ x: number; y: number }>({ x: posRef.current.x, y: posRef.current.y })

  // Ripples
  const ripplesRef = useRef<{ x: number; y: number; r: number; a: number }[]>([])

  // Textures and patterns
  const texturesRef = useRef<{ floor?: HTMLImageElement; rug?: HTMLImageElement }>({})
  const patternsRef = useRef<{ floor?: CanvasPattern; rug?: CanvasPattern }>({})

  // Objects (interactive)
  const objectsRef = useRef<WorldObject[]>([
    {
      id: "lamp1",
      type: "lamp",
      x: 11 * TILE,
      y: 2 * TILE,
      w: TILE,
      h: TILE * 2,
      interactive: true,
      state: { on: true },
    },
    {
      id: "rug1",
      type: "rug",
      x: 4 * TILE,
      y: 6 * TILE,
      w: TILE * 3,
      h: TILE * 2,
    },
    {
      id: "board1",
      type: "board",
      x: 1.5 * TILE,
      y: 1.2 * TILE,
      w: TILE * 2.5,
      h: TILE * 0.8,
      interactive: true,
      state: { highlight: false },
    },
  ])
  const hoverObjectRef = useRef<string | null>(null)

  // Room name ref
  const roomNameRef = useRef(roomName)
  useEffect(() => {
    roomNameRef.current = roomName
  }, [roomName])

  // Camera stream (video)
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    async function enableCam() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: 160, height: 160, facingMode: "user" },
          audio: false,
        })
        if (cancelled) return
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          await videoRef.current.play().catch(() => {})
        }
      } catch (e) {
        console.warn("No camera", e)
        setCamEnabled(false)
      }
    }
    if (camEnabled) {
      enableCam()
    } else {
      if (videoRef.current) videoRef.current.srcObject = null
      if (stream) stream.getTracks().forEach((t) => t.stop())
      stream = null
    }
    return () => {
      cancelled = true
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [camEnabled])

  // Microphone stream + analyser (voice activity)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const voiceLevelRef = useRef<number>(0) // 0..1
  const voiceBufRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    let cancelled = false
    async function enableMic() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        })
        if (cancelled) return
        audioStreamRef.current = s
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        audioCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(s)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.8
        src.connect(analyser)
        analyserRef.current = analyser

        // announce mic enabled
        channel.post({ type: "voice", payload: { id: myIdRef.current, level: 0, micEnabled: true } })
        const me = participantsRef.current[myIdRef.current]
        if (me) {
          me.micEnabled = true
        }
      } catch (e) {
        console.warn("No microphone", e)
        setMicEnabled(false)
      }
    }

    function disableMic() {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop())
        audioStreamRef.current = null
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
      analyserRef.current = null
      voiceLevelRef.current = 0
      channel.post({ type: "voice", payload: { id: myIdRef.current, level: 0, micEnabled: false } })
      const me = participantsRef.current[myIdRef.current]
      if (me) {
        me.micEnabled = false
        me.speakingLevel = 0
      }
    }

    if (micEnabled) enableMic()
    else disableMic()

    return () => {
      cancelled = true
      if (micEnabled) {
        // cleanup identical to disable
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach((t) => t.stop())
          audioStreamRef.current = null
        }
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {})
          audioCtxRef.current = null
        }
        analyserRef.current = null
      }
    }
  }, [micEnabled, channel])

  // Presence join/leave
  useEffect(() => {
    const now = Date.now()
    const me: Participant = {
      id: myIdRef.current,
      profile,
      x: posRef.current.x,
      y: posRef.current.y,
      dir: "down",
      camEnabled,
      micEnabled,
      speakingLevel: 0,
      lastSeen: now,
    }
    participantsRef.current[me.id] = me
    setParticipantsUI((s) => ({ ...s, [me.id]: me }))
    channel.post({ type: "join", payload: me })

    const onBeforeUnload = () => {
      channel.post({ type: "leave", payload: { id: myIdRef.current } })
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      channel.post({ type: "leave", payload: { id: myIdRef.current } })
    }
  }, []) // eslint-disable-line

  // Realtime messages
  useEffect(() => {
    function updateUIFromRef() {
      setParticipantsUI((prev) => {
        const next: Record<string, Participant> = { ...prev }
        for (const p of Object.values(participantsRef.current)) {
          const exists = prev[p.id]
          if (
            !exists ||
            exists.profile.name !== p.profile.name ||
            exists.profile.color !== p.profile.color ||
            exists.camEnabled !== p.camEnabled ||
            exists.micEnabled !== p.micEnabled
          ) {
            next[p.id] = { ...p, x: exists?.x ?? p.x, y: exists?.y ?? p.y }
          }
        }
        for (const id of Object.keys(prev)) {
          if (!participantsRef.current[id]) delete next[id]
        }
        return next
      })
    }

    let uiTimer: number | null = null
    const scheduleUI = () => {
      if (uiTimer) return
      uiTimer = window.setTimeout(() => {
        uiTimer = null
        updateUIFromRef()
      }, 150)
    }

    function onMsg(m: BroadcastMessage) {
      const now = Date.now()
      if (m.type === "join") {
        const p = m.payload as Participant
        participantsRef.current[p.id] = { ...p, lastSeen: now }
        scheduleUI()
        if (p.id !== myIdRef.current) {
          channel.post({
            type: "state",
            payload: {
              id: myIdRef.current,
              profile,
              x: posRef.current.x,
              y: posRef.current.y,
              dir: getDirFromVel(velRef.current),
              camEnabled,
              micEnabled,
              speakingLevel: 0,
            } as Participant,
          })
        }
      } else if (m.type === "state") {
        const p = m.payload as Participant
        participantsRef.current[p.id] = { ...p, lastSeen: now }
        scheduleUI()
      } else if (m.type === "move") {
        const p = m.payload as Pick<Participant, "id" | "x" | "y" | "dir">
        const exists = participantsRef.current[p.id]
        if (exists) {
          // optimize: only apply diffs
          if (Math.abs(exists.x - p.x) > 0.5 || Math.abs(exists.y - p.y) > 0.5) {
            participantsRef.current[p.id] = { ...exists, x: p.x, y: p.y, dir: p.dir, lastSeen: now }
          }
        }
      } else if (m.type === "avatar") {
        const p = m.payload as Pick<Participant, "id" | "profile" | "camEnabled" | "micEnabled">
        const exists = participantsRef.current[p.id]
        if (exists) {
          participantsRef.current[p.id] = {
            ...exists,
            profile: p.profile as AvatarProfile,
            camEnabled: !!p.camEnabled,
            micEnabled: !!(p as any).micEnabled,
            lastSeen: now,
          }
        } else {
          participantsRef.current[p.id] = {
            id: p.id,
            x: Math.round((WORLD_W * TILE) / 2),
            y: Math.round((WORLD_H * TILE) / 2),
            dir: "down",
            profile: p.profile as AvatarProfile,
            camEnabled: !!p.camEnabled,
            micEnabled: !!(p as any).micEnabled,
            speakingLevel: 0,
            lastSeen: now,
          }
        }
        scheduleUI()
      } else if (m.type === "voice") {
        const v = m.payload as { id: string; level: number; micEnabled: boolean }
        const exists = participantsRef.current[v.id]
        if (exists) {
          exists.micEnabled = v.micEnabled
          exists.speakingLevel = clamp(v.level, 0, 1)
          exists.lastSeen = now
        }
      } else if (m.type === "object") {
        // sync object state (e.g., lamp toggled)
        const { id, state } = m.payload as { id: string; state: Record<string, any> }
        const obj = objectsRef.current.find((o) => o.id === id)
        if (obj) {
          obj.state = { ...obj.state, ...state }
          // if lamp or board, needs redraw
          if (obj.type === "lamp" || obj.type === "board") {
            staticDirtyRef.current = true
          }
        }
      } else if (m.type === "leave") {
        const { id } = m.payload as { id: string }
        delete participantsRef.current[id]
        displayPosRef.current.delete(id)
        scheduleUI()
      } else if (m.type === "chat") {
        const c = m.payload as { id: string; name: string; text: string; ts: number }
        setLogs((l) => [...l.slice(-199), c])
      }
    }

    channel.subscribe(onMsg)
    return () => channel.unsubscribe(onMsg)
  }, [channel, profile, camEnabled, micEnabled])

  // Broadcast avatar updates (profile, cam, mic)
  useEffect(() => {
    channel.post({ type: "avatar", payload: { id: myIdRef.current, profile, camEnabled, micEnabled } })
    const me = participantsRef.current[myIdRef.current]
    if (me) {
      me.profile = profile
      me.camEnabled = camEnabled
      me.micEnabled = micEnabled
    }
  }, [profile, camEnabled, micEnabled]) // eslint-disable-line

  // Keyboard control
  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      const k = e.key.toLowerCase()
      keysRef.current.add(k)
      targetRef.current = null
    }
    function onUp(e: KeyboardEvent) {
      const k = e.key.toLowerCase()
      keysRef.current.delete(k)
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
    }
  }, [])

  // Static layer (cached)
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const staticDirtyRef = useRef(true)

  // Textures load
  useEffect(() => {
    const floor = new Image()
    floor.crossOrigin = "anonymous"
    floor.src = "/textures/floor-wood.png"
    floor.onload = () => {
      texturesRef.current.floor = floor
      staticDirtyRef.current = true
      // pattern created lazily in draw
    }
    const rug = new Image()
    rug.crossOrigin = "anonymous"
    rug.src = "/textures/rug.png"
    rug.onload = () => {
      texturesRef.current.rug = rug
      staticDirtyRef.current = true
    }
  }, [])

  // Pointer interactions (move + click-to-move + object toggle)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function toLocal(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    function onMove(e: PointerEvent) {
      const pt = toLocal(e)
      rawPointerRef.current = pt
      // hover highlight
      const obj = hitObject(objectsRef.current, pt)
      hoverObjectRef.current = obj?.id || null
    }

    function onDown(e: PointerEvent) {
      e.preventDefault()
      const pt = toLocal(e)
      // object interaction
      const obj = hitObject(objectsRef.current, pt)
      if (obj?.interactive) {
        if (obj.type === "lamp") {
          const on = !!obj.state?.on
          obj.state = { ...obj.state, on: !on }
          channel.post({ type: "object", payload: { id: obj.id, state: obj.state } })
          // feedback ripple
          ripplesRef.current.push({ x: obj.x + obj.w / 2, y: obj.y + obj.h * 0.15, r: 0, a: 1 })
          return
        }
        if (obj.type === "board") {
          const hl = !!obj.state?.highlight
          obj.state = { ...obj.state, highlight: !hl }
          channel.post({ type: "object", payload: { id: obj.id, state: obj.state } })
          return
        }
      }
      // otherwise click-to-move
      targetRef.current = pt
      ripplesRef.current.push({ x: pt.x, y: pt.y, r: 0, a: 1 })
    }

    canvas.addEventListener("pointermove", onMove, { passive: true })
    canvas.addEventListener("pointerdown", onDown)
    return () => {
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerdown", onDown)
    }
  }, [channel])

  // Main loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    function resize() {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.floor(w * DPR)
      canvas.height = Math.floor(h * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // Offscreen for face
    const off = document.createElement("canvas")
    off.width = 180
    off.height = 180
    const offCtx = off.getContext("2d")!

    let last = performance.now()
    let raf = 0
    let lastSend = 0
    let lastVoice = 0
    let prevVoiceLevel = 0

    function step(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      // Smooth pointer
      if (rawPointerRef.current) {
        pointerRef.current.x = lerp(pointerRef.current.x, rawPointerRef.current.x, 1 - Math.pow(0.001, dt))
        pointerRef.current.y = lerp(pointerRef.current.y, rawPointerRef.current.y, 1 - Math.pow(0.001, dt))
      }

      // Desired velocity
      const desired = getDesiredVelocity(dt, posRef.current, keysRef.current, targetRef.current)
      velRef.current.x = smoothApproach(velRef.current.x, desired.x, desired.x === 0 ? DECEL : ACCEL, dt)
      velRef.current.y = smoothApproach(velRef.current.y, desired.y, desired.y === 0 ? DECEL : ACCEL, dt)

      // Integrate
      const nx = clamp(posRef.current.x + velRef.current.x * dt, TILE / 2, WORLD_W * TILE - TILE / 2)
      const ny = clamp(posRef.current.y + velRef.current.y * dt, TILE / 2, WORLD_H * TILE - TILE / 2)
      posRef.current.x = nx
      posRef.current.y = ny

      // Arrived near target
      if (targetRef.current) {
        const dx = targetRef.current.x - posRef.current.x
        const dy = targetRef.current.y - posRef.current.y
        if (dx * dx + dy * dy < 9) targetRef.current = null
      }

      // Update my participant
      const my = participantsRef.current[myIdRef.current]
      const myDir = getDirFromVel(velRef.current)
      if (my) {
        my.x = posRef.current.x
        my.y = posRef.current.y
        my.dir = myDir
        my.lastSeen = Date.now()
        my.micEnabled = micEnabled
      }

      // Voice analysis
      const analyser = analyserRef.current
      if (analyser) {
        const buf = voiceBufRef.current
        const voiceBuffer = buf ? buf : (voiceBufRef.current = new Float32Array(analyser.fftSize))
        analyser.getFloatTimeDomainData(voiceBuffer)
        let sum = 0
        for (let i = 0; i < voiceBuffer.length; i++) sum += voiceBuffer[i] * voiceBuffer[i]
        const rms = Math.sqrt(sum / voiceBuffer.length) // ~0..1
        // Smooth level
        voiceLevelRef.current = lerp(voiceLevelRef.current, rms, 0.25)
        if (my) my.speakingLevel = voiceLevelRef.current
      } else {
        voiceLevelRef.current = 0
        if (my) my.speakingLevel = 0
      }

      // Throttle movement sends
      if (now - lastSend > SEND_RATE_MS) {
        lastSend = now
        channel.post({
          type: "move",
          payload: { id: myIdRef.current, x: posRef.current.x, y: posRef.current.y, dir: myDir },
        })
      }

      // Throttle voice level sends (only if changed meaningfully)
      if (now - lastVoice > VOICE_RATE_MS) {
        lastVoice = now
        const lvl = clamp(voiceLevelRef.current * 2.2, 0, 1) // normalize a bit hotter
        if (Math.abs(lvl - prevVoiceLevel) > 0.03 || !micEnabled !== !my?.micEnabled) {
          prevVoiceLevel = lvl
          channel.post({ type: "voice", payload: { id: myIdRef.current, level: lvl, micEnabled } })
        }
      }

      // Remote display smoothing
      for (const [id, p] of Object.entries(participantsRef.current)) {
        if (id === myIdRef.current) {
          displayPosRef.current.set(id, { x: p.x, y: p.y })
          continue
        }
        const disp = displayPosRef.current.get(id) || { x: p.x, y: p.y }
        disp.x = lerp(disp.x, p.x, 1 - Math.pow(1 - LERP_REMOTE / 60, dt * 60))
        disp.y = lerp(disp.y, p.y, 1 - Math.pow(1 - LERP_REMOTE / 60, dt * 60))
        displayPosRef.current.set(id, disp)
      }

      // Ripples
      ripplesRef.current = ripplesRef.current
        .map((r) => ({ ...r, r: r.r + 90 * dt, a: r.a - 1.2 * dt }))
        .filter((r) => r.a > 0)

      // Draw
      // If static layer dirty, rebuild
      if (staticDirtyRef.current) {
        staticDirtyRef.current = false
        const staticCanvas = staticCanvasRef.current || (staticCanvasRef.current = document.createElement("canvas"))
        staticCanvas.width = canvas.width
        staticCanvas.height = canvas.height
        const staticCtx = staticCanvas.getContext("2d")!
        buildStaticLayer(staticCtx, {
          W: canvas.clientWidth,
          H: canvas.clientHeight,
          theme: themeConf,
          patterns: patternsRef.current,
          objects: objectsRef.current,
        })
      }

      // Draw static layer
      if (staticCanvasRef.current) {
        ctx.drawImage(staticCanvasRef.current, 0, 0)
      }

      drawScene(ctx, offCtx, {
        theme: themeConf,
        roomName: roomNameRef.current,
        participants: participantsRef.current,
        displayPos: displayPosRef.current,
        localId: myIdRef.current,
        video: videoRef.current,
        pointer: pointerRef.current,
        ripples: ripplesRef.current,
        textures: texturesRef.current,
        patterns: patternsRef.current,
        objects: objectsRef.current,
        hoverObjectId: hoverObjectRef.current,
      })

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [themeConf, channel, micEnabled])

  const sendMessage = useCallback(
    (txt: string) => {
      const trimmed = txt.trim()
      if (!trimmed) return
      const c = { id: myIdRef.current, name: profile.name, text: trimmed, ts: Date.now() }
      setLogs((l) => [...l.slice(-199), c])
      setMsg("")
      channel.post({ type: "chat", payload: c })

      const me = participantsRef.current[myIdRef.current]
      if (me) {
        ;(me.profile as any).bubble = trimmed
        setTimeout(() => {
          const m2 = participantsRef.current[myIdRef.current]
          if (m2 && (m2.profile as any).bubble === trimmed) {
            delete (m2.profile as any).bubble
          }
        }, 3000)
      }
    },
    [channel, profile.name]
  )

  return (
    <div className="flex h-[100dvh] w-full">
      {/* World */}
      <div className="relative flex-1 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-crosshair"
          role="img"
          aria-label={`Sala virtual ${roomName} com avatares em um cenário pseudo‑3D`}
        />
        <video ref={videoRef} className="hidden" playsInline muted aria-hidden />

        {/* Top bar */}
        <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={camEnabled ? "default" : "outline"}
                  className={cn(camEnabled ? "bg-fuchsia-600 hover:bg-fuchsia-700 text-white" : "")}
                  onClick={() => setCamEnabled((v) => !v)}
                  aria-pressed={camEnabled}
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{"Câmera no rosto do avatar"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={micEnabled ? "default" : "outline"}
                  className={cn(
                    micEnabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "",
                    "relative overflow-hidden"
                  )}
                  onClick={() => setMicEnabled((v) => !v)}
                  aria-pressed={micEnabled}
                  title={micEnabled ? "Microfone ligado" : "Microfone desligado"}
                >
                  {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{"Indicador de voz visível no avatar e na lista"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="outline">
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{"Configurações (em breve)"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="ml-2">
            <TransportBadge />
          </div>
        </div>

        {/* Chat toggle */}
        <button
          className="pointer-events-auto absolute right-3 top-3 inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm shadow-sm hover:bg-zinc-50"
          onClick={() => setChatOpen((v) => !v)}
          aria-expanded={chatOpen}
        >
          <MessageCircle className="h-4 w-4 text-sky-600" />
          <span className="hidden sm:inline">{"Chat"}</span>
          {chatOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Right panel */}
      <aside
        className={cn("w-[320px] shrink-0 border-l bg-white transition-transform", chatOpen ? "translate-x-0" : "translate-x-full")}
        aria-label="Painel lateral com participantes e chat"
      >
        <div className="flex h-full flex-col">
          <div className="p-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600" />
              {"Participantes"}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {Object.values(participantsUI).map((p) => {
                const speaking = (p.speakingLevel || 0) > 0.08 && p.micEnabled
                return (
                  <Card key={p.id} className={cn("p-2", speaking ? "ring-2 ring-emerald-400" : "")} aria-live="polite">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div aria-hidden className="h-6 w-6 rounded-full" style={{ background: p.profile.color }} />
                        <div className="truncate text-sm">{p.profile.name || "Convidado"}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {p.micEnabled ? (
                          <Mic className={cn("h-4 w-4", speaking ? "text-emerald-600" : "text-zinc-500")} />
                        ) : (
                          <MicOff className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>

            <Separator className="my-4" />

            <h3 className="text-sm font-medium flex items-center gap-2">
              <Palette className="h-4 w-4 text-violet-600" />
              {"Seu avatar"}
            </h3>
            <div className="mt-2 space-y-2">
              <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Seu nome" aria-label="Seu nome" />
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={profile.color}
                  onChange={(e) => setProfile({ ...profile, color: e.target.value })}
                  aria-label="Cor do avatar"
                  className="h-9 w-12 cursor-pointer rounded border"
                />
                <Input
                  value={profile.accessory}
                  onChange={(e) => setProfile({ ...profile, accessory: e.target.value })}
                  placeholder="Acessório (ex: Chapéu)"
                  aria-label="Acessório do avatar"
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="p-4">
              <h2 className="text-lg font-semibold">{"Chat"}</h2>
            </div>
            <ScrollArea className="flex-1 px-4">
              <div className="space-y-3 pb-4">
                {logs.map((l, idx) => (
                  <div key={idx} className="text-sm">
                    <span className="font-medium" style={{ color: l.id === myIdRef.current ? profile.color : undefined }}>
                      {l.name || "Convidado"}
                    </span>
                    {": "}
                    <span className="text-zinc-700">{l.text}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="border-t p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  sendMessage(msg)
                }}
                className="flex items-center gap-2"
              >
                <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Digite uma mensagem..." aria-label="Caixa de mensagem" />
                <Button type="submit" className="bg-sky-600 hover:bg-sky-700">
                  {"Enviar"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ---------------- Drawing and scene helpers ---------------- */

function drawScene(
  ctx: CanvasRenderingContext2D,
  offCtx: CanvasRenderingContext2D,
  opts: {
    theme: (typeof themePresets)["meeting"]
    roomName: string
    participants: Record<string, Participant>
    displayPos: Map<string, { x: number; y: number }>
    localId: string
    video: HTMLVideoElement | null
    pointer: { x: number; y: number }
    ripples: { x: number; y: number; r: number; a: number }[]
    textures: { floor?: HTMLImageElement; rug?: HTMLImageElement }
    patterns: { floor?: CanvasPattern; rug?: CanvasPattern }
    objects: WorldObject[]
    hoverObjectId: string | null
  }
) {
  const { theme, roomName, participants, displayPos, localId, video, pointer, ripples, textures, patterns, objects, hoverObjectId } = opts
  const canvas = ctx.canvas as HTMLCanvasElement
  const W = canvas.clientWidth
  const H = canvas.clientHeight

  // Create patterns lazily
  if (!patterns.floor && textures.floor) {
    patterns.floor = ctx.createPattern(textures.floor, "repeat") || undefined
  }
  if (!patterns.rug && textures.rug) {
    patterns.rug = ctx.createPattern(textures.rug, "repeat") || undefined
  }

  // Background: textured floor with subtle perspective gradient (darker far top)
  if (patterns.floor) {
    ctx.fillStyle = patterns.floor
    ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = theme.colors.floor
    ctx.fillRect(0, 0, W, H)
  }

  // Perspective shading
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, "rgba(0,0,0,0.18)")
  grad.addColorStop(0.4, "rgba(0,0,0,0.06)")
  grad.addColorStop(1, "rgba(255,255,255,0.0)")
  ctx.fillStyle = grad
  ctx.globalCompositeOperation = "multiply"
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = "source-over"

  // Soft fake vignette for depth
  const vign = ctx.createRadialGradient(W / 2, H * 0.65, Math.min(W, H) * 0.2, W / 2, H * 0.65, Math.max(W, H))
  vign.addColorStop(0, "rgba(0,0,0,0)")
  vign.addColorStop(1, "rgba(0,0,0,0.12)")
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, W, H)

  // Grid lines (faint, thicker near bottom to fake perspective)
  ctx.strokeStyle = theme.colors.grid
  for (let y = 0; y <= WORLD_H; y++) {
    const ly = y * TILE
    ctx.lineWidth = 1 + (y / WORLD_H) * 0.5
    ctx.beginPath()
    ctx.moveTo(0, ly)
    ctx.lineTo(WORLD_W * TILE, ly)
    ctx.stroke()
  }
  for (let x = 0; x <= WORLD_W; x++) {
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x * TILE, 0)
    ctx.lineTo(x * TILE, WORLD_H * TILE)
    ctx.stroke()
  }

  // Draw objects with faux 3D and shadows
  for (const obj of objects) {
    drawObject(ctx, obj, patterns, hoverObjectId === obj.id)
  }

  // Compute draw order by y (use display positions)
  const toDraw: Participant[] = Object.values(participants).map((p) => {
    const disp = displayPos.get(p.id) || { x: p.x, y: p.y }
    return { ...p, x: disp.x, y: disp.y }
  })
  toDraw.sort((a, b) => a.y - b.y)

  // Draw avatars
  for (const p of toDraw) {
    drawAvatar(ctx, p, p.id === localId, video, offCtx, pointer)
  }

  // Dynamic lighting: lamp glow and pointer highlight
  const lamps = objects.filter((o) => o.type === "lamp" && o.state?.on)
  if (lamps.length) {
    ctx.globalCompositeOperation = "lighter"
    for (const l of lamps) {
      const cx = l.x + l.w / 2
      const cy = l.y + l.h * 0.15
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, TILE * 3.5)
      grad.addColorStop(0, "rgba(255,228,150,0.55)")
      grad.addColorStop(0.4, "rgba(255,220,120,0.35)")
      grad.addColorStop(1, "rgba(255,200,90,0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = "source-over"
  }

  // Pointer small highlight for interactivity feel
  const pg = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 120)
  pg.addColorStop(0, "rgba(255,255,255,0.05)")
  pg.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = pg
  ctx.fillRect(0, 0, W, H)

  // Ripples
  for (const r of ripples) {
    ctx.beginPath()
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(99,102,241,${Math.max(0, Math.min(1, r.a))})`
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // Room banner
  const pad = 10
  const text = roomName
  ctx.font = "600 16px ui-sans-serif, system-ui, -apple-system"
  const tw = ctx.measureText(text).width
  const bx = pad
  const by = pad
  const bw = tw + 24
  const bh = 28
  ctx.fillStyle = theme.colors.banner
  ctx.strokeStyle = "#00000015"
  ctx.lineWidth = 1.5
  roundRect(ctx, bx, by, bw, bh, 8)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = theme.colors.bannerText
  ctx.fillText(text, bx + 12, by + 19)
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: WorldObject,
  patterns: { floor?: CanvasPattern; rug?: CanvasPattern },
  hover: boolean
) {
  // Drop shadow under object for depth
  ctx.save()
  ctx.fillStyle = "rgba(0,0,0,0.15)"
  ctx.beginPath()
  ctx.ellipse(obj.x + obj.w / 2, obj.y + obj.h, obj.w * 0.45, obj.h * 0.18, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (obj.type === "rug") {
    ctx.save()
    if (patterns.rug) ctx.fillStyle = patterns.rug
    else ctx.fillStyle = "#d4d4f5"
    roundRect(ctx, obj.x, obj.y, obj.w, obj.h, 10)
    ctx.fill()
    ctx.strokeStyle = hover ? "#a78bfa" : "#00000010"
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
    return
  }

  if (obj.type === "lamp") {
    const on = !!obj.state?.on
    const baseX = obj.x + obj.w / 2
    const baseY = obj.y + obj.h
    // pole
    ctx.strokeStyle = "#475569"
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(baseX, baseY)
    ctx.lineTo(baseX, obj.y + obj.h * 0.25)
    ctx.stroke()
    // head
    ctx.fillStyle = on ? "#fde68a" : "#e2e8f0"
    roundRect(ctx, baseX - obj.w * 0.25, obj.y, obj.w * 0.5, obj.h * 0.35, 8)
    ctx.fill()
    ctx.strokeStyle = hover ? "#f59e0b" : "#00000020"
    ctx.lineWidth = 2
    ctx.stroke()
    // small indicator
    ctx.beginPath()
    ctx.arc(baseX + obj.w * 0.28, obj.y + obj.h * 0.18, 4, 0, Math.PI * 2)
    ctx.fillStyle = on ? "#22c55e" : "#ef4444"
    ctx.fill()
    return
  }

  if (obj.type === "board") {
    ctx.save()
    // panel
    roundRect(ctx, obj.x, obj.y, obj.w, obj.h, 6)
    ctx.fillStyle = obj.state?.highlight ? "#fef08a" : "#e5e7eb"
    ctx.fill()
    ctx.strokeStyle = hover ? "#a3a3a3" : "#00000010"
    ctx.lineWidth = 2
    ctx.stroke()
    // content lines
    ctx.fillStyle = "#94a3b8"
    for (let i = 0; i < 3; i++) {
      const y = obj.y + 10 + i * (obj.h / 3)
      ctx.fillRect(obj.x + 10, y, obj.w - 20, 2)
    }
    ctx.restore()
    return
  }
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  p: Participant,
  isLocal: boolean,
  video: HTMLVideoElement | null,
  offCtx: CanvasRenderingContext2D,
  pointer: { x: number; y: number }
) {
  const headR = 18
  const bodyW = 34
  const bodyH = 30

  // Shadow (longer when lower in scene to mimic depth)
  const shadowScale = 1 + (p.y / (WORLD_H * TILE)) * 0.2
  ctx.fillStyle = "rgba(0,0,0,0.10)"
  ctx.beginPath()
  ctx.ellipse(p.x, p.y + bodyH / 2 + 6, 20 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2)
  ctx.fill()

  // Body
  ctx.fillStyle = p.profile.color
  roundRect(ctx, p.x - bodyW / 2, p.y - bodyH / 2, bodyW, bodyH, 8)
  ctx.fill()

  // Mic ring/indicator first so head overlays nicely
  const micOn = !!p.micEnabled
  const lvl = clamp((p.speakingLevel || 0), 0, 1)
  if (micOn || lvl > 0.01) {
    const glow = lvl > 0.08
    const ringColor = glow ? `rgba(16,185,129,${0.7 + 0.3 * lvl})` : "rgba(148,163,184,0.7)"
    ctx.strokeStyle = ringColor
    ctx.lineWidth = 2 + lvl * 4
    ctx.beginPath()
    ctx.arc(p.x, p.y - bodyH / 2 - headR + 6, headR + 4 + lvl * 2, 0, Math.PI * 2)
    ctx.stroke()

    // small LED badge on shoulder
    ctx.fillStyle = glow ? "#22c55e" : micOn ? "#94a3b8" : "#ef4444"
    ctx.beginPath()
    ctx.arc(p.x + bodyW / 2 - 6, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // muted dot
    ctx.fillStyle = "#ef4444"
    ctx.beginPath()
    ctx.arc(p.x + bodyW / 2 - 6, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // Accessory label
  if (p.profile.accessory) {
    ctx.font = "500 10px ui-sans-serif, system-ui"
    ctx.fillStyle = "#00000070"
    const text = p.profile.accessory.slice(0, 10)
    const tw = ctx.measureText(text).width
    roundRect(ctx, p.x - tw / 2 - 6, p.y + bodyH / 2 + 8, tw + 12, 16, 8)
    ctx.fillStyle = "#ffffffd0"
    ctx.fill()
    ctx.fillStyle = "#111"
    ctx.fillText(text, p.x - tw / 2, p.y + bodyH / 2 + 20)
  }

  // Head pos
  const headCx = p.x
  const headCy = p.y - bodyH / 2 - headR + 6

  // Webcam face or placeholder
  if (isLocal && video && !video.paused && !video.ended) {
    const dx = (pointer.x - headCx) * 0.04
    const dy = (pointer.y - headCy) * 0.04

    offCtx.save()
    offCtx.clearRect(0, 0, offCtx.canvas.width, offCtx.canvas.height)
    offCtx.translate(offCtx.canvas.width / 2, offCtx.canvas.height / 2)
    offCtx.beginPath()
    offCtx.arc(0, 0, headR, 0, Math.PI * 2)
    offCtx.closePath()
    offCtx.clip()
    const vw = video.videoWidth || 160
    const vh = video.videoHeight || 160
    const scale = Math.max((headR * 2) / vw, (headR * 2) / vh) * 1.4
    const drawW = vw * scale
    const drawH = vh * scale
    offCtx.drawImage(video, -drawW / 2 - dx, -drawH / 2 - dy, drawW, drawH)
    offCtx.restore()

    ctx.drawImage(offCtx.canvas, headCx - offCtx.canvas.width / 2, headCy - offCtx.canvas.height / 2)

    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(headCx, headCy, headR + 2, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.fillStyle = "#f1f5f9"
    ctx.beginPath()
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "#00000015"
    ctx.stroke()
    ctx.font = "700 12px ui-sans-serif, system-ui"
    const initials = getInitials(p.profile.name)
    const tw = ctx.measureText(initials).width
    ctx.fillStyle = "#0f172a"
    ctx.fillText(initials, headCx - tw / 2, headCy + 4)
  }

  // Nameplate
  if (p.profile.name) {
    ctx.font = "600 12px ui-sans-serif, system-ui"
    const tw = ctx.measureText(p.profile.name).width
    ctx.fillStyle = "rgba(255,255,255,0.92)"
    roundRect(ctx, p.x - tw / 2 - 6, headCy - headR - 22, tw + 12, 18, 9)
    ctx.fill()
    ctx.strokeStyle = "#00000015"
    ctx.stroke()
    ctx.fillStyle = "#0f172a"
    ctx.fillText(p.profile.name, p.x - tw / 2, headCy - headR - 9)
  }

  // Speech bubble
  const bubble = (p.profile as any)?.bubble as string | undefined
  if (bubble) {
    ctx.font = "500 12px ui-sans-serif, system-ui"
    const text = bubble.length > 30 ? bubble.slice(0, 30) + "…" : bubble
    const tw = ctx.measureText(text).width
    ctx.fillStyle = "rgba(255,255,255,0.95)"
    roundRect(ctx, p.x - tw / 2 - 8, headCy - headR - 46, tw + 16, 22, 10)
    ctx.fill()
    ctx.strokeStyle = "#00000012"
    ctx.stroke()
    ctx.fillStyle = "#0f172a"
    ctx.fillText(text, p.x - tw / 2, headCy - headR - 30)
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function getInitials(name: string) {
  if (!name) return "🙂"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function smoothApproach(current: number, target: number, gain: number, dt: number) {
  const t = 1 - Math.exp(-gain * dt)
  return current + (target - current) * t
}
function getDesiredVelocity(
  dt: number,
  pos: { x: number; y: number },
  keys: Set<string>,
  target: { x: number; y: number } | null
) {
  let vx = 0
  let vy = 0
  const up = keys.has("arrowup") || keys.has("w")
  const down = keys.has("arrowdown") || keys.has("s")
  const left = keys.has("arrowleft") || keys.has("a")
  const right = keys.has("arrowright") || keys.has("d")

  if (up) vy -= 1
  if (down) vy += 1
  if (left) vx -= 1
  if (right) vx += 1

  if (vx !== 0 || vy !== 0) {
    const mag = Math.hypot(vx, vy) || 1
    vx = (vx / mag) * BASE_SPEED
    vy = (vy / mag) * BASE_SPEED
    return { x: vx, y: vy }
  }

  if (target) {
    const dx = target.x - pos.x
    const dy = target.y - pos.y
    const dist = Math.hypot(dx, dy)
    if (dist > 1) {
      const speed = BASE_SPEED
      return { x: (dx / dist) * speed, y: (dy / dist) * speed }
    }
  }
  return { x: 0, y: 0 }
}
function getDirFromVel(vel: { x: number; y: number }): Participant["dir"] {
  const ax = Math.abs(vel.x)
  const ay = Math.abs(vel.y)
  if (ax > ay) return vel.x >= 0 ? "right" : "left"
  if (ay > 0) return vel.y >= 0 ? "down" : "up"
  return "down"
}
function hitObject(objects: WorldObject[], pt: { x: number; y: number }) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (pt.x >= o.x && pt.x <= o.x + o.w && pt.y >= o.y && pt.y <= o.y + o.h) return o
  }
  return null
}

function buildStaticLayer(
  ctx: CanvasRenderingContext2D,
  opts: {
    W: number
    H: number
    theme: (typeof themePresets)['meeting']
    patterns: { floor?: CanvasPattern; rug?: CanvasPattern }
    objects: WorldObject[]
  }
) {
  const { W, H, theme, patterns, objects } = opts
  // Background
  if (patterns.floor) {
    ctx.fillStyle = patterns.floor!
    ctx.fillRect(0, 0, W, H)
  } else {
    ctx.fillStyle = theme.colors.floor
    ctx.fillRect(0, 0, W, H)
  }
  // Perspective gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, "rgba(0,0,0,0.18)")
  grad.addColorStop(0.4, "rgba(0,0,0,0.06)")
  grad.addColorStop(1, "rgba(255,255,255,0.0)")
  ctx.fillStyle = grad
  ctx.globalCompositeOperation = "multiply"
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = "source-over"

  // Grid (pré-rasterizado)
  ctx.strokeStyle = theme.colors.grid
  for (let y = 0; y <= WORLD_H; y++) {
    const ly = y * TILE
    ctx.lineWidth = 1 + (y / WORLD_H) * 0.5
    ctx.beginPath()
    ctx.moveTo(0, ly)
    ctx.lineTo(WORLD_W * TILE, ly)
    ctx.stroke()
  }
  for (let x = 0; x <= WORLD_W; x++) {
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x * TILE, 0)
    ctx.lineTo(x * TILE, WORLD_H * TILE)
    ctx.stroke()
  }

  // Objetos sem estados dinâmicos (desenho base)
  for (const obj of objects) {
    drawObject(ctx, obj, patterns, false)
  }
}
