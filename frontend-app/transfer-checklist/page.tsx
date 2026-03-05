"use client"

import { useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { TransferChecklist } from "@/components/clinical/transfer-checklist"
import { HeaderTicker } from "@/components/clinical/notification-overlays"
import { AppSidebar, type SidebarPage } from "@/components/dashboard/app-sidebar"
import { BottomNav } from "@/components/dashboard/bottom-nav"
import { V1Header } from "@/components/dashboard/v1-header"
import { NotificationProvider } from "@/lib/notification-context"
import { SettingsProvider, useSettings } from "@/lib/settings-context"
import { usePatients } from "@/lib/hooks/use-patients"

function TransferChecklistInner({
  patients,
  loading,
}: {
  patients: Parameters<typeof TransferChecklist>[0]["patients"]
  loading: boolean
}) {
  const { showTicker } = useSettings()
  const searchParams = useSearchParams()
  const patientId = searchParams.get("patientId") ?? undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V1Header
        title="전원 체크리스트"
        subtitle="환자 전원 전 안정성 · 자원 평가 체크"
        subtitlePlacement="right"
      />
      {showTicker && <HeaderTicker />}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-20 xl:pb-6">
        <div className="mx-auto max-w-[1280px]">
          {loading ? (
            <p className="text-muted-foreground">환자 데이터 로딩 중...</p>
          ) : (
            <TransferChecklist patients={patients} initialPatientId={patientId} />
          )}
        </div>
      </main>
    </div>
  )
}

function TransferChecklistContent({
  patients,
  loading,
}: {
  patients: Parameters<typeof TransferChecklist>[0]["patients"]
  loading: boolean
}) {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center"><p className="text-muted-foreground">로딩 중...</p></div>}>
      <TransferChecklistInner patients={patients} loading={loading} />
    </Suspense>
  )
}

export default function TransferChecklistPage() {
  const router = useRouter()
  const { patients, loading } = usePatients()

  const handleNavigate = useCallback(
    (page: SidebarPage) => {
      if (page === "pc") router.push("/")
      else if (page === "infection") router.push("/?view=infection")
      else if (page === "transfer") router.push("/patients")
      else if (page === "report") router.push("/bed-allocation")
      else if (page === "autodraft") router.push("/?view=autodraft")
      else if (page === "isolation") router.push("/isolation-checklist")
      else if (page === "transferChecklist") router.push("/transfer-checklist")
    },
    [router]
  )

  return (
    <SettingsProvider>
      <NotificationProvider patients={patients} onNavigateToPatient={() => {}}>
        <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
          <div className="hidden h-full xl:flex">
            <AppSidebar currentPage="transferChecklist" onNavigate={handleNavigate} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-16 xl:pb-0">
            <TransferChecklistContent patients={patients} loading={loading} />
          </div>
          <div className="fixed bottom-0 left-0 right-0 z-50 xl:hidden">
            <BottomNav currentPage="transferChecklist" onNavigate={handleNavigate} />
          </div>
        </div>
      </NotificationProvider>
    </SettingsProvider>
  )
}
