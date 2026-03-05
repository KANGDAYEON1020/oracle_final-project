"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchPatients } from "@/lib/api";
import { useDemoClock } from "@/lib/demo-clock-context";

const MDRO_TYPES = [
  { type: "CRE", fullName: "Carbapenem-Resistant Enterobacteriaceae" },
  { type: "VRE", fullName: "Vancomycin-Resistant Enterococci" },
  { type: "MRSA", fullName: "Methicillin-Resistant S. aureus" },
];

interface MdroRow {
  type: string;
  fullName: string;
  total: number;
  newCases: number;
  ongoing: number;
  isolationDelay: number;
}

function normalizeMdroType(patient: any): string | null {
  if (typeof patient?.mdroStatus === "string") return patient.mdroStatus;
  if (patient?.mdroStatus?.mdroType) return patient.mdroStatus.mdroType;
  if (patient?.mdroType) return patient.mdroType;
  return null;
}

export function MdroPanel() {
  const [mdroData, setMdroData] = useState<MdroRow[]>([]);
  const { demoStep, demoShift } = useDemoClock();

  useEffect(() => {
    async function fetchAndAggregate() {
      try {
        const patients = await fetchPatients({ demoStep, demoShift });

        // mdroStatus 필드 기준 집계
        const aggregated = MDRO_TYPES.map(({ type, fullName }) => {
          const matched = patients.filter((p: any) => normalizeMdroType(p) === type);
          const newCases = matched.filter((p: any) => p.isNewMdro === true).length;
          const isolationDelay = matched.filter(
            (p: any) =>
              p.isolationDelay === true ||
              (p?.mdroStatus?.isolationRequired === true &&
                p?.mdroStatus?.isolationImplemented === false)
          ).length;

          return {
            type,
            fullName,
            total: matched.length,
            newCases,
            ongoing: Math.max(0, matched.length - newCases),
            isolationDelay,
          };
        });

        setMdroData(aggregated);
      } catch (err) {
        console.error("MDRO 집계 실패:", err);
      }
    }

    fetchAndAggregate();
  }, [demoShift, demoStep]);

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">
          MDRO 중점 관리 (MDRO Focus Panel)
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          다제내성균 관리 현황
        </p>
      </CardHeader>
      <CardContent>
        <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  균주 (Type)
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                  관리중 (Under Mgmt.)
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                  신규 (New)
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                  재원 (Ongoing)
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                  격리 지연 (Isolation Delay)
                </th>
              </tr>
            </thead>
            <tbody>
              {mdroData.map((row) => (
                <tr
                  key={row.type}
                  className="border-t border-border transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-semibold text-foreground">
                        {row.type}
                      </span>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        {row.fullName}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-foreground">
                    {row.total}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      variant="secondary"
                      className="bg-primary/10 text-primary text-[10px] font-medium"
                    >
                      +{row.newCases}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center text-foreground">
                    {row.ongoing}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.isolationDelay > 0 ? (
                      <Badge
                        variant="secondary"
                        className="bg-destructive/10 text-destructive text-[10px] font-medium"
                      >
                        {row.isolationDelay} delay
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 lg:hidden">
          {mdroData.map((row) => (
            <div key={row.type} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{row.type}</p>
                  <p className="text-[10px] leading-tight text-muted-foreground">{row.fullName}</p>
                </div>
                <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] font-medium">
                  관리중 {row.total}
                </Badge>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-border/70 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">신규</p>
                  <p className="text-sm font-semibold text-foreground">{row.newCases}</p>
                </div>
                <div className="rounded-md border border-border/70 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">재원</p>
                  <p className="text-sm font-semibold text-foreground">{row.ongoing}</p>
                </div>
                <div className="rounded-md border border-border/70 px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">격리 지연</p>
                  <p className="text-sm font-semibold text-destructive">
                    {row.isolationDelay > 0 ? row.isolationDelay : "-"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
