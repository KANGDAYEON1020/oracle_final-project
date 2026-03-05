"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { CircleHelp } from "lucide-react"
import { BedAllocationApp } from "@/components/bed-allocation/bed-allocation-app"
import { AppSidebar, type SidebarPage } from "@/components/dashboard/app-sidebar"
import { V1Header } from "@/components/dashboard/v1-header"
import { SettingsProvider } from "@/lib/settings-context"
import { NotificationProvider } from "@/lib/notification-context"
import { usePatients } from "@/lib/hooks/use-patients"
import { BottomNav } from "@/components/dashboard/bottom-nav"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// ... imports ...

export default function BedAllocationPage() {
    const router = useRouter()
    const { patients } = usePatients()

    const handleNavigate = useCallback(
        (page: SidebarPage) => {
            if (page === "pc") {
                router.push("/")
            } else if (page === "infection") {
                router.push("/?view=infection")
            } else if (page === "transfer") {
                router.push("/patients")
            }
        },
        [router]
    )

    return (
        <SettingsProvider>
            <NotificationProvider
                patients={patients}
                onNavigateToPatient={() => { }}
            >
                <div className="flex h-dvh overflow-hidden bg-background flex-col md:flex-row">
                    <div className="hidden xl:flex h-full">
                        <AppSidebar currentPage="report" onNavigate={handleNavigate} />
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-16 xl:pb-0">
                        <div className="hidden md:block">
                            <V1Header
                                title="Smart Bed 병상 시스템"
                                subtitle="병상 배정 시스템"
                                titleControls={
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                aria-label="격리 로직 안내"
                                            >
                                                <CircleHelp className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" align="start" className="max-w-[360px] space-y-1.5 p-3 text-xs leading-relaxed">
                                            <p className="font-semibold">자동 배치 격리 로직</p>
                                            <p>1) 환자 병원체/임상 플래그로 Tier(S/A/B)와 격리유형을 판정합니다.</p>
                                            <p>2) Tier 환자는 5F 격리병동 빈 병상을 우선 탐색합니다.</p>
                                            <p>3) 코호트는 cohort key 완전 일치 + 동일 성별 다인실만 허용합니다.</p>
                                            <p>4) 청소 필요 병상은 자동 배치에서 제외합니다.</p>
                                            <p>5) 조건을 만족하는 병상이 없으면 충돌 사유와 함께 제외됩니다.</p>
                                        </TooltipContent>
                                    </Tooltip>
                                }
                            />
                        </div>

                        <main className="flex flex-col min-h-0 flex-1 overflow-hidden">
                            <BedAllocationApp embedded />
                        </main>
                    </div>

                    <div className="fixed bottom-0 left-0 right-0 z-50 xl:hidden">
                        <BottomNav
                            currentPage="report"
                            onNavigate={handleNavigate}
                        />
                    </div>
                </div>
            </NotificationProvider>
        </SettingsProvider>
    )
}
