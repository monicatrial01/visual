export type AvatarProfile = {
  name: string
  color: string
  accessory?: string
  // ephemeral bubble is allowed but not stored persistently
}

const COLORS = ["#7c3aed", "#16a34a", "#0ea5e9", "#f97316", "#ef4444", "#14b8a6", "#6b7280"]

export function getDefaultProfile(): AvatarProfile {
  const c = COLORS[Math.floor(Math.random() * COLORS.length)]
  return {
    name: "Convidado",
    color: c,
    accessory: "",
  }
}
