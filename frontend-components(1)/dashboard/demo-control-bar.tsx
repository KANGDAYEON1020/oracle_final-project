"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEMO_SHIFTS,
  type DemoShift,
  useDemoClock,
} from "@/lib/demo-clock-context";
import { appendDemoParams, buildPathWithQuery } from "@/lib/demo-query";
import { cn } from "@/lib/utils";

const ALERTS_PROXY_BASE = "/api";

function normalizeApiBase(base?: string): string {
  const resolved = (base && base.trim()) || "/api";
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
}

const API_BASE_URL = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL);

async function resetAlertsDemoState(demoStep: number, demoShift: DemoShift): Promise<void> {
  const params = new URLSearchParams();
  appendDemoParams(params, { demoStep, demoShift });
  const bases = Array.from(new Set([ALERTS_PROXY_BASE, API_BASE_URL]));
  let lastError: unknown = null;

  for (const base of bases) {
    const url = buildPathWithQuery(`${base}/alerts/demo-reset`, params);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to reset alerts: ${response.status}`);
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to reset alerts");
}

function formatDemoDate(step: number): string {
  const base = new Date("2026-02-09T00:00:00");
  base.setDate(base.getDate() + (step - 1));
  return base.toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

const SHIFT_LABEL: Record<DemoShift, string> = {
  Day: "Day",
  Evening: "Eve",
  Night: "Night",
};

interface DemoControlBarProps {
  collapsed?: boolean;
}

export function DemoControlBar({ collapsed = false }: DemoControlBarProps) {
  const {
    demoStep,
    demoShift,
    minStep,
    maxStep,
    prevStep,
    nextStep,
    setDemoShift,
    resetDemoClock,
  } = useDemoClock();
  const [mounted, setMounted] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const displayStep = mounted ? demoStep : minStep;
  const displayShift = mounted ? demoShift : DEMO_SHIFTS[0];
  const isPrevDisabled = !mounted || displayStep <= minStep;
  const isNextDisabled = !mounted || displayStep >= maxStep;

  const handleReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await resetAlertsDemoState(demoStep, demoShift);
      localStorage.setItem("look-demo-step", "1");
      localStorage.setItem("look-demo-shift", "Day");
      resetDemoClock();
      window.location.assign("/");
    } catch (error) {
      console.error("Failed to reset demo clock and alerts:", error);
    } finally {
      setResetting(false);
    }
  };

  if (collapsed) {
    return (
      <div className="px-2 pb-2">
        <div className="rounded-lg border border-border/70 bg-muted/40 px-2 py-1.5 text-center text-[10px] font-semibold text-muted-foreground">
          D{displayStep}
        </div>
      </div>
    );
  }

  return (
    <section className="mx-3 mb-3 rounded-xl border border-border/80 bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Demo Clock
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={handleReset}
          disabled={resetting}
          aria-label="Demo clock 초기화"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-lg border border-border/70 bg-background px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={prevStep}
          disabled={isPrevDisabled}
          aria-label="이전 Demo step"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">
            Day {displayStep}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatDemoDate(displayStep)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={nextStep}
          disabled={isNextDisabled}
          aria-label="다음 Demo step"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1">
        {DEMO_SHIFTS.map((shift) => (
          <button
            key={shift}
            type="button"
            onClick={() => setDemoShift(shift)}
            disabled={!mounted}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              displayShift === shift
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {SHIFT_LABEL[shift]}
          </button>
        ))}
      </div>
    </section>
  );
}
