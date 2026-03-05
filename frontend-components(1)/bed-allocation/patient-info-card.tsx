"use client"

import { User, AlertTriangle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface PatientInfoCardProps {
  patient: {
    id: number
    name: string
    age: number
    gender: "M" | "F"
    infectionType: string
    admissionDate: string
  }
}

export function PatientInfoCard({ patient }: PatientInfoCardProps) {
  const genderLabel = patient.gender === "M" ? "남" : "여"
  
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
            <User className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">{patient.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {patient.age}세 / {genderLabel} / ID: {patient.id}
                </p>
              </div>
              <Badge 
                variant="outline" 
                className="border-danger bg-danger/10 text-danger px-3 py-1.5 text-sm font-medium"
              >
                <AlertTriangle className="mr-1.5 h-4 w-4" />
                {patient.infectionType}
              </Badge>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span>입원일: {patient.admissionDate}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
