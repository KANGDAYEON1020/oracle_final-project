"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPatients } from "@/lib/api";
import { useDemoClock } from "@/lib/demo-clock-context";

export type InfectionTypeName = "Pneumonia" | "GI" | "UTI" | "Tickborne" | "Others";

export interface InfectionTypeDatum {
  name: InfectionTypeName;
  nameKo: string;
  value: number;
}

export const INFECTION_TYPES: ReadonlyArray<{ name: InfectionTypeName; nameKo: string }> = [
  { name: "Pneumonia", nameKo: "폐렴" },
  { name: "GI", nameKo: "소화기" },
  { name: "UTI", nameKo: "요로감염" },
  { name: "Tickborne", nameKo: "진드기매개" },
  { name: "Others", nameKo: "기타" },
];

const COLORS = [
  "hsl(210, 55%, 48%)",
  "hsl(175, 35%, 48%)",
  "hsl(220, 25%, 35%)",
  "hsl(35, 60%, 55%)",
  "hsl(0, 45%, 58%)",
];

function buildEmptyInfectionTypeData(): InfectionTypeDatum[] {
  return INFECTION_TYPES.map((t) => ({ ...t, value: 0 }));
}

function getInfectionType(code: string | null): InfectionTypeName {
  if (!code) return "Others";
  const prefix = code.charAt(0).toUpperCase();
  switch (prefix) {
    case "P":
      return "Pneumonia";
    case "G":
      return "GI";
    case "U":
      return "UTI";
    case "T":
      return "Tickborne";
    default:
      return "Others";
  }
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; nameKo: string; value: number };
    value: number;
  }>;
}) {
  if (active && payload && payload.length) {
    const d = payload[0];
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
        <p className="text-sm font-medium text-foreground">
          {d.payload.nameKo}
        </p>
        <p className="text-xs text-muted-foreground">{d.payload.name}</p>
        <p className="text-sm font-bold text-foreground">{d.value} events</p>
      </div>
    );
  }
  return null;
}

interface InfectionTypeChartProps {
  data?: InfectionTypeDatum[];
  loading?: boolean;
}

export function InfectionTypeChart({ data, loading = false }: InfectionTypeChartProps) {
  const isControlled = Array.isArray(data);
  const [internalData, setInternalData] = useState<InfectionTypeDatum[]>(buildEmptyInfectionTypeData);
  const [internalLoading, setInternalLoading] = useState(true);
  const { demoStep, demoShift } = useDemoClock();

  useEffect(() => {
    if (isControlled) return;

    async function fetchAndAggregate() {
      setInternalLoading(true);
      try {
        const patients = await fetchPatients({ demoStep, demoShift });

        // infection 코드 접두어로 집계
        const counts: Partial<Record<InfectionTypeName, number>> = {};
        for (const p of patients) {
          const infectionCode =
            (p as { infection?: string | null }).infection ??
            (p as { infection_type?: string | null }).infection_type ??
            null;
          const type = getInfectionType(infectionCode);
          counts[type] = (counts[type] || 0) + 1;
        }

        const aggregated = INFECTION_TYPES.map(({ name, nameKo }) => ({
          name,
          nameKo,
          value: counts[name] || 0,
        }));

        setInternalData(aggregated);
      } catch (err) {
        console.error("Infection 집계 실패:", err);
      } finally {
        setInternalLoading(false);
      }
    }
    fetchAndAggregate();
  }, [demoShift, demoStep, isControlled]);

  const resolvedData = isControlled ? data : internalData;
  const resolvedLoading = isControlled ? loading : internalLoading;

  const total = resolvedData.reduce((s, d) => s + d.value, 0);
  const hasData = total > 0;
  const pieData = hasData
    ? resolvedData.filter((item) => item.value > 0)
    : [{ name: "no-data", nameKo: "데이터 없음", value: 1 }];

  if (resolvedLoading) {
    return (
      <Card className="border border-border bg-card">
        <CardContent className="flex h-[280px] items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">
          감염 유형별 현황 (Infection Monitoring Events by Type)
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          모니터링 이벤트 건수 - Counts represent infection monitoring events,
          not confirmed diagnoses.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 xl:flex-row xl:items-center xl:gap-6">
          <div className="h-[180px] w-[180px] shrink-0 md:h-[200px] md:w-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((item, index) => (
                    <Cell
                      key={`cell-${item.name}-${index}`}
                      fill={hasData ? COLORS[index % COLORS.length] : "hsl(210, 10%, 85%)"}
                    />
                  ))}
                </Pie>
                {hasData && <Tooltip content={<CustomTooltip />} />}
              </PieChart>
            </ResponsiveContainer>
          </div>
          {!hasData && (
            <p className="text-xs text-muted-foreground xl:hidden">
              표시 가능한 감염 유형 데이터가 없습니다.
            </p>
          )}
          <div className="w-full max-w-[360px] space-y-2">
            {resolvedData.map((item, i) => (
              <div key={item.name} className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: COLORS[i] }}
                />
                <span className="w-16 text-xs text-foreground xl:w-20">
                  {item.nameKo}
                </span>
                <span className="text-[11px] text-muted-foreground xl:text-xs">
                  {item.name}
                </span>
                <span className="ml-auto text-xs font-semibold text-foreground">
                  {item.value}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({total > 0 ? Math.round((item.value / total) * 100) : 0}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
