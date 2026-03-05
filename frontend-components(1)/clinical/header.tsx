"use client"

import { useState } from "react"
import { Settings, User, Eye, ChevronDown, Building2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SettingsDialog } from "@/components/clinical/settings-dialog"
import { NotificationBellPanel } from "@/components/clinical/notification-bell-panel"
import { cn } from "@/lib/utils"

// Ward/Hospital data - Updated floor definitions per PRD
// 1F: 외래/진단(입원 배정 전 단계)
// 2F: 일반병동 A (폐렴/UTI) / 병실 8개
// 3F: 일반병동 B (GI 감염/수술후) / 병실 8개
// 5F: 격리·고위험 병동(MDRO/접촉격리) / 병실 8개
const hospitals = [
  {
    id: "h1",
    name: "서울대학교병원",
    wards: [
      { id: "w1", name: "외래/진단", floor: "1F", focus: "입원 배정 전", rooms: 0 },
      { id: "w2", name: "일반병동 A", floor: "2F", focus: "폐렴 / UTI", rooms: 8 },
      { id: "w3", name: "일반병동 B", floor: "3F", focus: "GI 감염 / 수술후", rooms: 8 },
      { id: "w4", name: "격리·고위험 병동", floor: "5F", focus: "MDRO / 접촉격리", rooms: 8 },
    ]
  },
  {
    id: "h2",
    name: "분당서울대병원",
    wards: [
      { id: "w5", name: "외래/진단", floor: "1F", focus: "입원 배정 전", rooms: 0 },
      { id: "w6", name: "일반병동 A", floor: "2F", focus: "폐렴 / UTI", rooms: 8 },
      { id: "w7", name: "일반병동 B", floor: "3F", focus: "GI 감염 / 수술후", rooms: 8 },
      { id: "w8", name: "격리·고위험 병동", floor: "5F", focus: "MDRO / 접촉격리", rooms: 8 },
    ]
  }
]

// Define PageType locally or import if centralized
export type PageType = "pc" | "transfer" | "infection" | "report" | "autodraft"

interface HeaderProps {
  currentPage?: PageType
  onPageChange?: (page: PageType) => void
}

export function Header({ currentPage = "pc", onPageChange }: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedHospital, setSelectedHospital] = useState(hospitals[0])
  const [selectedWard, setSelectedWard] = useState(hospitals[0].wards[0])

  const handleWardSelect = (hospitalId: string, wardId: string) => {
    const hospital = hospitals.find(h => h.id === hospitalId)
    const ward = hospital?.wards.find(w => w.id === wardId)
    if (hospital && ward) {
      setSelectedHospital(hospital)
      setSelectedWard(ward)
    }
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold text-foreground">LOOK</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={currentPage === "pc" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onPageChange?.("pc")}
            >
              환자 모니터링
            </Button>
            <Button
              variant={currentPage === "transfer" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onPageChange?.("transfer")}
            >
              전원 체크리스트
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Ward Context Switcher */}
          <div className="mr-4 flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        id="main-header-ward-trigger"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 border-primary/30 hover:border-primary/50 hover:bg-primary/5 bg-transparent"
                      >
                        <Building2 className="h-4 w-4 text-primary" />
                        <span className="font-medium">{selectedWard.name} ({selectedWard.floor})</span>
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent id="main-header-ward-content" align="end" className="w-72">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        병원 및 병동 선택
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {hospitals.map((hospital) => (
                        <div key={hospital.id}>
                          <DropdownMenuLabel className="text-xs font-medium text-foreground py-1.5">
                            {hospital.name}
                          </DropdownMenuLabel>
                          {hospital.wards.map((ward) => (
                            <DropdownMenuItem
                              key={ward.id}
                              onClick={() => handleWardSelect(hospital.id, ward.id)}
                              className={cn(
                                "flex items-center justify-between py-2 cursor-pointer",
                                selectedWard.id === ward.id && "bg-primary/10"
                              )}
                            >
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">
                                  {ward.name} ({ward.floor})
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {ward.focus}
                                </span>
                              </div>
                              {selectedWard.id === ward.id && (
                                <Check className="h-4 w-4 text-primary" />
                              )}
                            </DropdownMenuItem>
                          ))}
                          {hospital.id !== hospitals[hospitals.length - 1].id && (
                            <DropdownMenuSeparator />
                          )}
                        </div>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-center">
                  <p className="text-xs">병동 단위 감시 및 통계를 전환합니다.</p>
                  <p className="text-[10px] text-muted-foreground">환자 이동은 포함하지 않습니다.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-border">|</span>
            <Badge variant="secondary" className="text-xs">
              {selectedWard.focus}
            </Badge>
          </div>

          {/* Notification Bell - wired to NotificationProvider */}
          <NotificationBellPanel />

          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-5 w-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id="main-header-user-menu-trigger" variant="ghost" size="icon">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent id="main-header-user-menu-content" align="end">
              <DropdownMenuItem>프로필</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>설정</DropdownMenuItem>
              <DropdownMenuItem>로그아웃</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
