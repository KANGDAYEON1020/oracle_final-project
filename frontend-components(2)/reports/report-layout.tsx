"use client";

import { useState, useRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Download, Calendar, FileText } from "lucide-react";
import { OverviewSummaryCard } from "@/components/reports/overview-summary-card";
import { EventsByTypeCard } from "@/components/reports/events-by-type-card";
import { TrendChartCard } from "@/components/reports/trend-chart-card";
import { MdroFocusPanelCard } from "@/components/reports/mdro-focus-panel-card";
import { ActionSummaryCard } from "@/components/reports/action-summary-card";
import { WardComparisonCard } from "@/components/reports/ward-comparison-card";
import { QuarterlyDeepDiveCard } from "@/components/reports/quarterly-deep-dive-card";
import { AnnualBenchmarkCard } from "@/components/reports/annual-benchmark-card";
import { getMockReportData } from "@/lib/mock-report-data";
import type { ReportPeriod } from "@/lib/report-types";
import { getPeriodLabel } from "@/lib/report-types";

const PERIODS: ReportPeriod[] = ["7d", "1M", "3M", "12M"];

interface ReportLayoutProps {
  initialPeriod?: ReportPeriod;
  onBack?: () => void;
}

export function ReportLayout({
  initialPeriod = "7d",
  onBack,
}: ReportLayoutProps) {
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);
  const [isExporting, setIsExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const reportData = getMockReportData(period);

  const handleDownloadPdf = async () => {
    if (!contentRef.current) return;

    try {
      setIsExporting(true);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const canvas = await html2canvas(contentRef.current, {
        scale: 1.5,
        logging: false,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        foreignObjectRendering: false,
        onclone: (clonedDoc) => {
          const allElements = clonedDoc.querySelectorAll("*");
          allElements.forEach((el) => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.style) {
              const computed = window.getComputedStyle(el);
              const bgColor = computed.backgroundColor;
              const color = computed.color;
              if (bgColor.includes("oklab") || bgColor.includes("oklch")) {
                htmlEl.style.backgroundColor = "#ffffff";
              }
              if (color.includes("oklab") || color.includes("oklch")) {
                htmlEl.style.color = "#1a1a1a";
              }
            }
          });
        },
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.8);
      const pdf = new jsPDF("p", "mm", "a4"); // Portrait for reports
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(
        pdfWidth / imgWidth,
        (pdfHeight * 0.95) / imgHeight,
      );

      const imgPrWidth = imgWidth * ratio;
      const imgPrHeight = imgHeight * ratio;

      const x = (pdfWidth - imgPrWidth) / 2;
      const y = 5;

      pdf.addImage(imgData, "JPEG", x, y, imgPrWidth, imgPrHeight);

      const now = new Date();
      const timestamp =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        "_" +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0");
      pdf.save(`INFECT_GUARD_Report_${period}_${timestamp}.pdf`);
    } catch (error) {
      console.error("PDF generation failed:", error);
      alert("PDF 생성에 실패했습니다.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-bold text-foreground">
                Infection Monitoring Report
              </h1>
              <p className="text-xs text-muted-foreground">
                감염 모니터링 보고서 · Generated{" "}
                {new Date().toLocaleDateString("ko-KR")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Period Selector */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
              <Calendar className="ml-2 h-4 w-4 text-muted-foreground" />
              {PERIODS.map((p) => (
                <Button
                  key={p}
                  variant={period === p ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPeriod(p)}
                >
                  {getPeriodLabel(p)}
                </Button>
              ))}
            </div>
            {/* Export Button */}
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={handleDownloadPdf}
              disabled={isExporting}
            >
              <Download className="h-4 w-4" />
              {isExporting ? "저장 중..." : "PDF 저장"}
            </Button>
            {/* Back Button */}
            {onBack && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                닫기
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div ref={contentRef} className="px-6 py-6 space-y-6 bg-background">
          {/* Disclaimer */}
          <div className="text-[10px] text-muted-foreground bg-muted/30 px-3 py-2 rounded-md">
            ⚠️ Counts represent infection monitoring events, not confirmed
            diagnoses. 본 보고서의 수치는 감염 모니터링 이벤트이며, 확정 진단
            수가 아닙니다.
          </div>

          {/* Overview Summary */}
          <OverviewSummaryCard data={reportData.overview} />

          {/* Charts Row */}
          <div className="grid grid-cols-2 gap-4">
            <EventsByTypeCard data={reportData.eventsByType} />
            <TrendChartCard data={reportData.trend} period={period} />
          </div>

          {/* MDRO + Action Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <MdroFocusPanelCard data={reportData.mdroFocus} period={period} />
            </div>
            <ActionSummaryCard data={reportData.actionSummary} />
          </div>

          {/* Period-Specific Cards */}
          {period === "1M" && reportData.wardComparison && (
            <WardComparisonCard data={reportData.wardComparison} />
          )}

          {period === "3M" && reportData.quarterlyDeepDive && (
            <QuarterlyDeepDiveCard data={reportData.quarterlyDeepDive} />
          )}

          {period === "12M" && reportData.annualBenchmark && (
            <AnnualBenchmarkCard data={reportData.annualBenchmark} />
          )}
        </div>
      </div>
    </div>
  );
}
