import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper to clean up long alert strings (e.g., combined MDRO + Isolation alerts)
export function cleanAlertString(text: string | null | undefined): string {
  if (!text) return ""

  if (text.includes("MDRO confirmed:") || text.includes("Isolation not applied")) {
    const parts: string[] = []

    // Extracts "MDRO confirmed: CRE"
    const mdroMatch = text.match(/MDRO confirmed:\s*(\w+)/)
    if (mdroMatch) {
      parts.push(mdroMatch[0])
    }

    // Extracts "Isolation not applied (gap)"
    if (text.includes("Isolation not applied (gap)")) {
      parts.push("Isolation not applied (gap)")
    }

    if (parts.length > 0) return parts.join(" / ")
  }

  // Remove "D+N" from patterns like "(HD5 D+4)" -> "(HD5)"
  // Also generic " D+N" removal if it appears elsewhere in parentheses
  // Case: "... (HD5 D+4)" -> "... (HD5)"
  return text.replace(/(\(HD\d+)\s+D\+\d+(\))/g, "$1$2")
}
