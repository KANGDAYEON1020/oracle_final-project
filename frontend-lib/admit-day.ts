export function formatAdmitDayLabel(admitDay: string | null | undefined): string {
  const raw = String(admitDay ?? "").trim()
  if (!raw) return "Day 1"

  const hdMatch = raw.match(/HD\s*(\d+)/i)
  if (hdMatch) {
    const hd = Number.parseInt(hdMatch[1], 10)
    return `Day ${Number.isFinite(hd) ? Math.max(1, hd) : 1}`
  }

  const dMatch = raw.match(/D\+?\s*(-?\d+)/i)
  if (dMatch) {
    const d = Number.parseInt(dMatch[1], 10)
    const day = Number.isFinite(d) ? d + 1 : 1
    return `Day ${Math.max(1, day)}`
  }

  return raw
}
