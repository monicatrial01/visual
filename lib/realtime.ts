"use client"

import { getSupabaseClient } from "./supabase-client"

export type BroadcastMessage =
  | { type: "join"; payload: any }
  | { type: "leave"; payload: { id: string } }
  | { type: "move"; payload: any }
  | { type: "chat"; payload: any }
  | { type: "state"; payload: any }
  | { type: "avatar"; payload: any }
  | { type: "voice"; payload: { id: string; level: number; micEnabled: boolean } }
  | { type: "object"; payload: { id: string; state: Record<string, any> } }

export type TransportKind = 'supabase' | 'broadcast' | 'localStorage'
let lastTransportKind: TransportKind = 'broadcast'
export function getTransportKind(): TransportKind {
  return lastTransportKind
}

type Handler = (m: BroadcastMessage) => void

// Adaptive transport: Supabase Realtime -> BroadcastChannel -> localStorage
export function useRoomChannel(roomId: string) {
  const key = `vm_room_${roomId}`
  const supa = getSupabaseClient()
  if (supa) {
    lastTransportKind = 'supabase'
    return supabaseChannel(supa, key)
  }
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    lastTransportKind = 'broadcast'
    return broadcastChannel(key)
  }
  lastTransportKind = 'localStorage'
  return localStorageChannel(key)
}

/* ------------------ Supabase transport ------------------ */
function supabaseChannel(supa: ReturnType<typeof getSupabaseClient> extends infer T ? (T extends null ? never : T) : never, key: string) {
  const channel = supa.channel(key, {
    config: { broadcast: { self: false } },
  })

  let handlers = new Set<Handler>()
  let subscribed = false

  function ensureSubscribe() {
    if (subscribed) return
    channel
      .on("broadcast", { event: "msg" }, (payload) => {
        const data = payload.payload as BroadcastMessage
        for (const fn of Array.from(handlers)) {
          try {
            fn(data)
          } catch {}
        }
      })
      .subscribe()
    subscribed = true
  }

  return {
    post: (m: BroadcastMessage) => {
      ensureSubscribe()
      channel.send({ type: "broadcast", event: "msg", payload: m })
    },
    subscribe: (fn: Handler) => {
      ensureSubscribe()
      handlers.add(fn)
      return () => {
        handlers.delete(fn)
      }
    },
    unsubscribe: (fn: Handler) => {
      handlers.delete(fn)
    },
  }
}

/* -------------- BroadcastChannel transport -------------- */
const channels = new Map<string, BroadcastChannel>()
const bcHandlers = new Map<string, Set<Handler>>()

function broadcastChannel(key: string) {
  let ch = channels.get(key)
  if (!ch) {
    ch = new BroadcastChannel(key)
    channels.set(key, ch)
    ch.onmessage = (e) => {
      const set = bcHandlers.get(key)
      if (!set) return
      for (const fn of Array.from(set)) {
        try {
          fn(e.data as BroadcastMessage)
        } catch {}
      }
    }
  }
  return {
    post: (m: BroadcastMessage) => ch!.postMessage(m),
    subscribe: (fn: Handler) => {
      let set = bcHandlers.get(key)
      if (!set) {
        set = new Set()
        bcHandlers.set(key, set)
      }
      set.add(fn)
      // return off
      return () => {
        set!.delete(fn)
      }
    },
    unsubscribe: (fn: Handler) => {
      const set = bcHandlers.get(key)
      if (!set) return
      set.delete(fn)
    },
  }
}

/* ---------------- localStorage transport ---------------- */
function localStorageChannel(key: string) {
  const PREFIX = `${key}_ls_`
  let handlers = new Set<Handler>()

  function onStorage(e: StorageEvent) {
    if (!e.key || !e.newValue) return
    if (!e.key.startsWith(PREFIX)) return
    try {
      const msg = JSON.parse(e.newValue) as BroadcastMessage
      for (const fn of Array.from(handlers)) {
        try {
          fn(msg)
        } catch {}
      }
      // cleanup key to avoid bloat
      localStorage.removeItem(e.key)
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage)
  }

  function post(m: BroadcastMessage) {
    try {
      const id = `${PREFIX}${Date.now()}_${Math.random().toString(16).slice(2)}`
      localStorage.setItem(id, JSON.stringify(m))
    } catch {}
  }

  function subscribe(fn: Handler) {
    handlers.add(fn)
    return () => {
      handlers.delete(fn)
      if (handlers.size === 0 && typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage)
      }
    }
  }

  function unsubscribe(fn: Handler) {
    handlers.delete(fn)
  }

  return { post, subscribe, unsubscribe }
}
