"use client"

import { useState, useEffect } from "react"
import type { Patient } from "@/lib/types"
import { fetchPatients } from "@/lib/api"
import { useDemoClock } from "@/lib/demo-clock-context"

export function usePatients() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { demoStep, demoShift } = useDemoClock()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchPatients({ demoStep, demoShift })
      .then((data) => {
        if (!cancelled) setPatients(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [demoShift, demoStep])

  return { patients, loading, error, setPatients }
}
