"use client"

import { useState } from "react"
import { Search, Building2, ChevronDown, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

// Ward/Hospital data
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

export function WardToolbar() {
    const [selectedHospital, setSelectedHospital] = useState(hospitals[0])
    const [selectedWard, setSelectedWard] = useState(hospitals[0].wards[3])

    const handleWardSelect = (hospitalId: string, wardId: string) => {
        const hospital = hospitals.find(h => h.id === hospitalId)
        const ward = hospital?.wards.find(w => w.id === wardId)
        if (hospital && ward) {
            setSelectedHospital(hospital)
            setSelectedWard(ward)
        }
    }

    return (
        <div className="flex items-center justify-between border-b border-border bg-card/50 px-6 py-3">
            {/* Left: Ward title + switcher + meta */}
            <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-foreground">
                        {selectedWard.name} Overview
                    </h2>

                    {/* Ward Context Switcher */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 hover:bg-muted"
                                        >
                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-72">
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
                                                        className="flex items-center justify-between py-2 cursor-pointer"
                                                    >
                                                        <div className="flex flex-col gap-0.5">
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
                                <p>현재 모니터링 중인 병동을 변경합니다.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                <p className="text-xs text-muted-foreground">
                    {selectedHospital.name} • {selectedWard.floor} • Last updated: Just now{" "}
                    <span className="font-medium text-primary">
                        {"• "}Live Feed
                    </span>
                </p>
            </div>

            {/* Right: Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="Search patient ID or name..."
                    className="h-9 w-64 rounded-lg border-border bg-background pl-9 text-sm placeholder:text-muted-foreground"
                />
            </div>
        </div>
    )
}
