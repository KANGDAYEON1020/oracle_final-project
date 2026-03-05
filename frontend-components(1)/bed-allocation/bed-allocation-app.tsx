"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Bell,
  Building2,
  ClipboardList,
  LayoutGrid,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QueueTab } from "./queue-tab";
import { BedboardTab } from "./bedboard-tab";
import { PlansTab } from "./plans-tab";
import { PlanReview } from "./plan-review";
import { HelpModal } from "./help-modal";
import { useDemoClock } from "@/lib/demo-clock-context";
import type {
  TransferCase,
  Room,
  Plan,
  Notification,
} from "@/lib/bed-allocation/types";
import {
  commitPlan,
  commitRoomChanges,
  escalatePlan,
  fetchAlerts,
  fetchPlans,
  fetchRooms,
  fetchTransferCases,
  generatePlan,
  rollbackPlan,
} from "@/lib/bed-allocation/api";

type TabType = "queue" | "bedboard" | "plans";
type ViewType = "tabs" | "plan-review";
type PendingBedOperation =
  | { type: "move"; patientId: string; fromBedId: string; toBedId: string }
  | { type: "remove"; bedId: string };

export function BedAllocationApp({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [currentTab, setCurrentTab] = useState<TabType>("queue");
  const [currentView, setCurrentView] = useState<ViewType>("tabs");
  const [cases, setCases] = useState<TransferCase[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [hasPendingBedChanges, setHasPendingBedChanges] = useState(false);
  const [pendingBedOperations, setPendingBedOperations] = useState<PendingBedOperation[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const { theme, setTheme } = useTheme();
  const { demoStep, demoShift, isHydrated } = useDemoClock();

  const demoQuery = useMemo(
    () => (isHydrated ? { demoStep, demoShift } : undefined),
    [demoShift, demoStep, isHydrated],
  );

  const loadData = useCallback(async () => {
    const [roomsData, casesData, plansData, alertsData] = await Promise.all([
      fetchRooms(undefined, demoQuery),
      fetchTransferCases(undefined, demoQuery),
      fetchPlans(undefined, demoQuery),
      fetchAlerts(["ACTIVE"], 200, demoQuery),
    ]);
    setRooms(roomsData);
    setCases(casesData);
    setPlans(plansData);
    setNotifications(alertsData);
  }, [demoQuery]);

  // API에서 초기 데이터 로드
  useEffect(() => {
    if (!isHydrated) return;
    async function bootstrap() {
      try {
        await loadData();
      } catch (err) {
        console.error("Failed to load data from API:", err);
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, [isHydrated, loadData]);

  useEffect(() => {
    if (!isHydrated) return;
    const handleDemoReset = () => {
      loadData().catch((err) => {
        console.error("Failed to reload bed allocation after demo reset:", err);
      });
    };
    window.addEventListener("alerts:local-reset", handleDemoReset);
    window.addEventListener("alerts:refresh", handleDemoReset);
    return () => {
      window.removeEventListener("alerts:local-reset", handleDemoReset);
      window.removeEventListener("alerts:refresh", handleDemoReset);
    };
  }, [isHydrated, loadData]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const queueCases = cases.filter((c) => c.status !== "COMMITTED");
  const waitingCount = queueCases.filter((c) => c.status === "WAITING").length;
  const draftPlanCount = plans.filter(
    (p) => p.status === "DRAFT" || p.status === "READY_TO_COMMIT",
  ).length;
  const totalBeds = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const occupiedBeds = rooms.reduce(
    (sum, room) => sum + room.beds.filter((bed) => bed.patient).length,
    0,
  );
  const tabItems = [
    { id: "queue" as const, label: "대기 환자", icon: ClipboardList, count: waitingCount },
    { id: "bedboard" as const, label: "병상 현황", icon: LayoutGrid, count: hasPendingBedChanges ? 1 : 0 },
    { id: "plans" as const, label: "배치 이력", icon: Building2, count: draftPlanCount },
  ];

  // 자동배치 생성
  const handleGeneratePlan = useCallback(
    async (selectedCases: TransferCase[]) => {
      const caseIds = selectedCases.map((item) => item.id);
      if (caseIds.length === 0) return;

      try {
        const newPlan = await generatePlan(caseIds, ["2F", "3F", "5F"], demoQuery);
        setActivePlan(newPlan);
        setCurrentView("plan-review");
        await loadData();
      } catch (error) {
        console.error("Failed to generate plan:", error);
        throw error;
      }
    },
    [demoQuery, loadData],
  );

  // 환자 이동 핸들러 (드래그 앤 드롭)
  const handleMovePatient = useCallback(
    async (
      patientId: string,
      fromRoomId: string,
      fromBedId: string,
      toRoomId: string,
      toBedId: string,
    ) => {
      // Optimistic UI update
      setRooms((prevRooms) => {
        const newRooms = [...prevRooms];

        // Find source room and bed
        const fromRoomIndex = newRooms.findIndex((r) => r.id === fromRoomId);
        const toRoomIndex = newRooms.findIndex((r) => r.id === toRoomId);

        if (fromRoomIndex === -1 || toRoomIndex === -1) return prevRooms;

        const fromRoom = newRooms[fromRoomIndex];
        const toRoom = newRooms[toRoomIndex];

        const fromBedIndex = fromRoom.beds.findIndex((b) => b.id === fromBedId);
        const toBedIndex = toRoom.beds.findIndex((b) => b.id === toBedId);

        if (fromBedIndex === -1 || toBedIndex === -1) return prevRooms;

        const patient = fromRoom.beds[fromBedIndex].patient;
        if (!patient) return prevRooms;

        // Move patient
        fromRoom.beds[fromBedIndex].patient = null;
        toRoom.beds[toBedIndex].patient = patient;

        // Update room metadata
        // Check if source room is now empty
        const fromRoomHasPatients = fromRoom.beds.some(
          (b) => b.patient !== null,
        );
        if (!fromRoomHasPatients) {
          fromRoom.cohortType = null;
          fromRoom.genderType = null;
        }

        // Update target room metadata if it was empty
        if (toRoom.capacity > 1 && !toRoom.genderType) {
          toRoom.genderType = patient.gender;
        }
        toRoom.cohortType = patient.infection;

        return newRooms;
      });

      // Mark as having pending changes
      setPendingBedOperations((prev) => [
        ...prev,
        {
          type: "move",
          patientId,
          fromBedId,
          toBedId,
        },
      ]);
      setHasPendingBedChanges(true);
    },
    [],
  );

  // 환자 제거 핸들러
  const handleRemovePatient = useCallback((roomId: string, bedId: string) => {
    setRooms((prevRooms) => {
      const newRooms = [...prevRooms];
      const roomIndex = newRooms.findIndex((r) => r.id === roomId);

      if (roomIndex === -1) return prevRooms;

      const room = newRooms[roomIndex];
      const bedIndex = room.beds.findIndex((b) => b.id === bedId);

      if (bedIndex === -1) return prevRooms;

      // Remove patient
      room.beds[bedIndex].patient = null;

      // Check if room is now empty
      const hasPatients = room.beds.some((b) => b.patient !== null);
      if (!hasPatients) {
        room.cohortType = null;
        room.genderType = null;
      }

      return newRooms;
    });

    // Mark as having pending changes
    setPendingBedOperations((prev) => [...prev, { type: "remove", bedId }]);
    setHasPendingBedChanges(true);
  }, []);

  // 베드 변경 확정 핸들러
  const handleConfirmBedChanges = useCallback(async () => {
    if (pendingBedOperations.length === 0) {
      setHasPendingBedChanges(false);
      return;
    }

    try {
      await commitRoomChanges(pendingBedOperations, demoQuery);
      await loadData();
      setPendingBedOperations([]);
      setHasPendingBedChanges(false);
    } catch (error) {
      console.error("Failed to commit room changes:", error);
    }
  }, [demoQuery, loadData, pendingBedOperations]);

  // 베드 변경 취소 핸들러
  const handleCancelBedChanges = useCallback(async () => {
    // API에서 최신 병실 데이터 다시 로드
    try {
      const roomsData = await fetchRooms(undefined, demoQuery);
      setRooms(roomsData);
    } catch (err) {
      console.error("Failed to reload rooms:", err);
    }
    setPendingBedOperations([]);
    setHasPendingBedChanges(false);
  }, [demoQuery]);

  // 배치안 업데이트
  const handleUpdatePlan = useCallback((updatedPlan: Plan) => {
    setActivePlan(updatedPlan);
  }, []);

  // 배치안 예외 처리
  const handleEscalateCase = useCallback(async (planId: string, caseId: string, reasonText: string) => {
    try {
      await escalatePlan(
        planId,
        [{ caseId }],
        "MANUAL_EXCEPTION",
        reasonText || "수동 예외 처리",
        demoQuery,
      );
      await loadData();
    } catch (error) {
      console.error("Failed to escalate case:", error);
    }
  }, [demoQuery, loadData]);

  // 배치안 확정
  const handleCommitPlan = useCallback(async (plan: Plan) => {
    try {
      await commitPlan(plan.id, plan.items, demoQuery);
      await loadData();
      setActivePlan(null);
      setCurrentView("tabs");
      setCurrentTab("bedboard");
    } catch (error) {
      console.error("Failed to commit plan:", error);
    }
  }, [demoQuery, loadData]);

  // 배치안 취소 (확정 전)
  const handleCancelPlan = useCallback(async () => {
    setActivePlan(null);
    setCurrentView("tabs");
    try {
      await loadData();
    } catch (error) {
      console.error("Failed to reload data after plan cancel:", error);
    }
  }, [loadData]);

  // 배치안 롤백 (확정 후 취소)
  const handleRollbackPlan = useCallback(async (plan: Plan) => {
    if (plan.status !== "COMMITTED") return;
    try {
      await rollbackPlan(plan.id, demoQuery);
      await loadData();
    } catch (error) {
      console.error("Failed to rollback plan:", error);
    }
  }, [demoQuery, loadData]);

  // 로딩 상태
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  // Plan Review 화면
  if (currentView === "plan-review" && activePlan) {
    return (
      <PlanReview
        plan={activePlan}
        rooms={rooms}
        onBack={() => {
          setCurrentView("tabs");
          setActivePlan(null);
        }}
        onCommit={handleCommitPlan}
        onCancel={handleCancelPlan}
        onUpdatePlan={handleUpdatePlan}
        onEscalateCase={handleEscalateCase}
      />
    );
  }

  // Main Tab View
  return (
    <div
      className={cn(
        "flex flex-col bg-background",
        embedded ? "h-full min-h-0" : "h-screen",
      )}
    >
      {/* Header */}
      {!embedded && (
        <header className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Smart Bed</h1>
              <p className="text-xs text-muted-foreground">병상 배정 시스템</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title="테마 변경"
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>

            {/* Help Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowHelpModal(true)}
              title="도움말"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </Button>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-destructive text-destructive-foreground text-xs">
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </div>
        </header>
      )}

      {/* Embedded Mobile Header */}
      {embedded && (
        <header className="border-b border-border bg-card px-4 py-3 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold text-foreground">Smart Bed 병상 시스템</h1>
              <p className="text-[11px] text-muted-foreground">대기 환자와 병상 상태를 빠르게 배정</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8 shrink-0"
              onClick={() => setShowHelpModal(true)}
              title="도움말"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none bg-destructive text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              )}
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">대기</p>
              <p className="font-semibold text-foreground">{waitingCount}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">배치안</p>
              <p className="font-semibold text-primary">{draftPlanCount}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">가동률</p>
              <p className="font-semibold text-foreground">
                {totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0}%
              </p>
            </div>
          </div>
        </header>
      )}

      {/* Embedded Mobile Tabs (top) */}
      {embedded && (
        <nav className="border-b border-border bg-card px-2 py-1.5 md:hidden">
          <div className="grid grid-cols-3 gap-1">
            {tabItems.map((tab) => {
              const isActive = currentTab === tab.id;
              return (
                <Button
                  key={tab.id}
                  variant="ghost"
                  onClick={() => setCurrentTab(tab.id)}
                  className={cn(
                    "relative h-10 justify-center gap-1 rounded-md px-2 text-xs",
                    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                      {tab.count > 9 ? "9+" : tab.count}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {currentTab === "queue" && (
          <QueueTab
            cases={queueCases}
            onGeneratePlan={handleGeneratePlan}
          />
        )}
        {currentTab === "bedboard" && (
          <BedboardTab
            rooms={rooms}
            isReadOnly={false}
            onMovePatient={handleMovePatient}
            onRemovePatient={handleRemovePatient}
            hasPendingChanges={hasPendingBedChanges}
            onConfirmChanges={handleConfirmBedChanges}
            onCancelChanges={handleCancelBedChanges}
          />
        )}
        {currentTab === "plans" && (
          <PlansTab
            plans={plans}
            onViewPlan={(plan) => {
              setActivePlan(plan)
              setCurrentView("plan-review")
            }}
            onRollback={handleRollbackPlan}
          />
        )}
      </div>

      {/* Tab Navigation */}
      <nav
        className={cn(
          "sticky bottom-0 z-20 items-center justify-around border-t border-border bg-card/95 px-1 pt-2 backdrop-blur",
          embedded ? "hidden md:flex" : "flex",
        )}
        style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
      >
        {tabItems.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <Button
              key={tab.id}
              variant="ghost"
              onClick={() => setCurrentTab(tab.id)}
              className={cn(
                "relative flex-1 flex-col h-auto gap-1 rounded-lg py-2.5",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <div className="relative">
                <tab.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                {tab.count > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                    {tab.count > 9 ? "9+" : tab.count}
                  </span>
                )}
              </div>
              <span className="text-xs">{tab.label}</span>
            </Button>
          );
        })}
      </nav>

      {/* Help Modal */}
      <HelpModal open={showHelpModal} onOpenChange={setShowHelpModal} />
    </div>
  );
}
