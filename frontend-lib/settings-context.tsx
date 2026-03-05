"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

export type FontSize = "small" | "medium" | "large" | "xlarge"

interface SettingsContextType {
  fontSize: FontSize
  setFontSize: (size: FontSize) => void
  showTicker: boolean
  setShowTicker: (show: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState<FontSize>("medium")
  const [showTicker, setShowTicker] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedFont = localStorage.getItem("look-font-size") as FontSize | null
    if (savedFont) {
      setFontSize(savedFont)
    }
    const savedTicker = localStorage.getItem("look-show-ticker")
    if (savedTicker !== null) {
      setShowTicker(savedTicker === "true")
    }
  }, [])

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("look-font-size", fontSize)
      document.documentElement.classList.remove(
        "text-size-small",
        "text-size-medium",
        "text-size-large",
        "text-size-xlarge"
      )
      document.documentElement.classList.add(`text-size-${fontSize}`)
    }
  }, [fontSize, mounted])

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("look-show-ticker", String(showTicker))
    }
  }, [showTicker, mounted])

  return (
    <SettingsContext.Provider value={{ fontSize, setFontSize, showTicker, setShowTicker }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider")
  }
  return context
}
