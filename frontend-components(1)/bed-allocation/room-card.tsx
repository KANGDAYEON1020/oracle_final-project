"use client"

import { Check, AlertCircle, X, Bed, Users } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type RoomStatus = "recommended" | "available" | "unavailable"

interface RoomCardProps {
  room: {
    roomNo: string
    gender: "M" | "F"
    occupiedCount: number
    capacity: number
    cohortType: string | null
    status: RoomStatus
    reason: string
  }
  targetInfection: string
  onSelect: (roomNo: string) => void
}

const statusConfig = {
  recommended: {
    icon: Check,
    label: "추천",
    borderClass: "border-success",
    bgClass: "bg-success/5",
    badgeClass: "bg-success text-success-foreground",
    iconClass: "text-success",
  },
  available: {
    icon: AlertCircle,
    label: "가능",
    borderClass: "border-warning",
    bgClass: "bg-warning/5",
    badgeClass: "bg-warning text-warning-foreground",
    iconClass: "text-warning",
  },
  unavailable: {
    icon: X,
    label: "불가",
    borderClass: "border-danger",
    bgClass: "bg-danger/5",
    badgeClass: "bg-danger text-danger-foreground",
    iconClass: "text-danger",
  },
}

export function RoomCard({ room, targetInfection, onSelect }: RoomCardProps) {
  const config = statusConfig[room.status]
  const StatusIcon = config.icon
  const genderLabel = room.gender === "M" ? "남" : "여"
  const isDisabled = room.status === "unavailable"
  
  return (
    <Card 
      className={cn(
        "transition-all duration-200 border-2",
        config.borderClass,
        config.bgClass,
        !isDisabled && "hover:shadow-lg cursor-pointer",
        isDisabled && "opacity-60"
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              room.status === "recommended" && "bg-success/20",
              room.status === "available" && "bg-warning/20",
              room.status === "unavailable" && "bg-danger/20"
            )}>
              <StatusIcon className={cn("h-5 w-5", config.iconClass)} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">{room.roomNo}</h3>
              <p className="text-sm text-muted-foreground">({genderLabel})</p>
            </div>
          </div>
          <Badge className={cn("px-3 py-1", config.badgeClass)}>
            {config.label}
          </Badge>
        </div>
        
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Bed className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">병상:</span>
            <span className="font-medium text-foreground">
              {room.occupiedCount}/{room.capacity} 사용 중
            </span>
          </div>
          
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">상태:</span>
            {room.cohortType ? (
              <Badge 
                variant="outline" 
                className={cn(
                  "text-xs",
                  room.cohortType === targetInfection 
                    ? "border-success text-success" 
                    : "border-danger text-danger"
                )}
              >
                {room.cohortType} 코호트
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">빈 방</span>
            )}
          </div>
        </div>
        
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          {room.reason}
        </p>
        
        <Button
          onClick={() => onSelect(room.roomNo)}
          disabled={isDisabled}
          className={cn(
            "w-full h-12 text-base font-medium",
            room.status === "recommended" && "bg-success hover:bg-success/90 text-success-foreground",
            room.status === "available" && "bg-warning hover:bg-warning/90 text-warning-foreground",
            isDisabled && "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {isDisabled ? "배정 불가" : "이 병실 선택"}
        </Button>
      </CardContent>
    </Card>
  )
}
