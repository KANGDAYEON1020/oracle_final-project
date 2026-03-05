"use client"

import { useCallback, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Search, BookOpen, FileText, ExternalLink, Sparkles, Clock, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

/* ─── Suggested starter queries ─── */
const SUGGESTED_QUERIES = [
    { label: "고령 환자 폐렴 치료 가이드라인?", icon: "🏥" },
    { label: "cre 일때 주의사항?", icon: "⚠️" },
    { label: "항상제 내성균 의심 ", icon: "🦠" },
]

interface SourceMaterial {
    id: string
    title: string
    section: string
    quote: string
    icon: string
    color: string
}

interface SearchResult {
    query: string
    elapsed: string
    sourceCount: number
    summary: string
    detailedContent: string
    precautions: string
    rawMarkdown?: string
    sources: SourceMaterial[]
}

type MarkdownNode =
    | { type: "h2"; text: string }
    | { type: "h3"; text: string }
    | { type: "p"; text: string }
    | { type: "ul"; items: string[] }
    | { type: "blockquote"; text: string }
    | { type: "hr" }

const CITATION_TOKEN_RE = /(\[[^\]]*출처\s*\d+[^\]]*\])/g
const CITATION_DETECT_RE = /\[[^\]]*출처\s*\d+[^\]]*\]/

function normalizeSource(source: Partial<SourceMaterial>, index: number): SourceMaterial {
    const fallbackIcons = ["📄", "📋", "📑", "🧾", "📚"]
    const fallbackColors = ["rose", "blue", "emerald", "amber", "violet"]
    return {
        id: source.id || `src-${index + 1}`,
        title: source.title || `근거문헌 ${index + 1}`,
        section: source.section || "섹션 정보 없음",
        quote: source.quote || "인용문이 제공되지 않았습니다.",
        icon: source.icon || fallbackIcons[index % fallbackIcons.length],
        color: source.color || fallbackColors[index % fallbackColors.length],
    }
}

function isBlockStart(line: string): boolean {
    const t = line.trim()
    return (
        t.startsWith("## ") ||
        t.startsWith("### ") ||
        t.startsWith("- ") ||
        t.startsWith("* ") ||
        t.startsWith("> ") ||
        t.startsWith("---")
    )
}

function parseMarkdownBlocks(markdown: string): MarkdownNode[] {
    const lines = markdown.split(/\r?\n/)
    const nodes: MarkdownNode[] = []
    let i = 0

    while (i < lines.length) {
        const raw = lines[i]
        const line = raw.trim()

        if (!line) {
            i += 1
            continue
        }

        if (line.startsWith("---")) {
            nodes.push({ type: "hr" })
            i += 1
            continue
        }

        if (line.startsWith("### ")) {
            nodes.push({ type: "h3", text: line.slice(4).trim() })
            i += 1
            continue
        }

        if (line.startsWith("## ")) {
            nodes.push({ type: "h2", text: line.slice(3).trim() })
            i += 1
            continue
        }

        if (line.startsWith("- ") || line.startsWith("* ")) {
            const items: string[] = []
            while (i < lines.length) {
                const li = lines[i].trim()
                if (!(li.startsWith("- ") || li.startsWith("* "))) break
                items.push(li.replace(/^[-*]\s+/, "").trim())
                i += 1
            }
            if (items.length) nodes.push({ type: "ul", items })
            continue
        }

        if (line.startsWith("> ")) {
            const quoteLines: string[] = []
            while (i < lines.length) {
                const q = lines[i].trim()
                if (!q.startsWith("> ")) break
                quoteLines.push(q.slice(2).trim())
                i += 1
            }
            nodes.push({ type: "blockquote", text: quoteLines.join("\n") })
            continue
        }

        const paraLines: string[] = []
        while (i < lines.length) {
            const p = lines[i].trim()
            if (!p) break
            if (isBlockStart(lines[i])) break
            paraLines.push(p)
            i += 1
        }
        if (paraLines.length) {
            nodes.push({ type: "p", text: paraLines.join("\n") })
        } else {
            i += 1
        }
    }

    return nodes
}

function extractCitationNumber(token: string): number | null {
    const match = token.match(/출처\s*(\d+)/)
    if (!match) return null
    const num = Number(match[1])
    return Number.isFinite(num) ? num : null
}

function renderInlineWithCitations(
    text: string,
    onCitationClick: (citationNo: number) => void,
    keyPrefix: string,
): ReactNode {
    const parts = text.split(CITATION_TOKEN_RE)
    return parts.map((part, idx) => {
        if (!part) return null

        if (CITATION_DETECT_RE.test(part)) {
            const citationNo = extractCitationNumber(part)
            if (!citationNo) return <span key={`${keyPrefix}-${idx}`}>{part}</span>
            return (
                <button
                    key={`${keyPrefix}-${idx}`}
                    type="button"
                    onClick={() => onCitationClick(citationNo)}
                    className="mx-0.5 rounded border border-primary/25 bg-primary/5 px-1 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                    title={`출처 ${citationNo}로 이동`}
                >
                    {part}
                </button>
            )
        }

        return <span key={`${keyPrefix}-${idx}`}>{part}</span>
    })
}

function GuidelineMarkdown({
    markdown,
    onCitationClick,
}: {
    markdown: string
    onCitationClick: (citationNo: number) => void
}) {
    const nodes = parseMarkdownBlocks(markdown)

    if (!nodes.length) {
        return <p className="text-sm text-muted-foreground">Markdown 본문이 비어 있습니다.</p>
    }

    return (
        <div className="space-y-3">
            {nodes.map((node, idx) => {
                if (node.type === "h2") {
                    return (
                        <h2 key={`md-h2-${idx}`} className="mt-4 text-lg font-bold text-foreground first:mt-0">
                            {node.text}
                        </h2>
                    )
                }
                if (node.type === "h3") {
                    return (
                        <h3 key={`md-h3-${idx}`} className="mt-3 text-base font-semibold text-foreground">
                            {node.text}
                        </h3>
                    )
                }
                if (node.type === "p") {
                    return (
                        <p key={`md-p-${idx}`} className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                            {renderInlineWithCitations(node.text, onCitationClick, `md-p-${idx}`)}
                        </p>
                    )
                }
                if (node.type === "ul") {
                    return (
                        <ul key={`md-ul-${idx}`} className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {node.items.map((item, itemIdx) => (
                                <li key={`md-ul-${idx}-${itemIdx}`} className="leading-relaxed">
                                    {renderInlineWithCitations(item, onCitationClick, `md-li-${idx}-${itemIdx}`)}
                                </li>
                            ))}
                        </ul>
                    )
                }
                if (node.type === "blockquote") {
                    return (
                        <blockquote
                            key={`md-bq-${idx}`}
                            className="rounded-r-md border-l-2 border-primary/30 bg-primary/5 px-3 py-2 text-sm italic text-muted-foreground"
                        >
                            {renderInlineWithCitations(node.text, onCitationClick, `md-bq-${idx}`)}
                        </blockquote>
                    )
                }
                return <hr key={`md-hr-${idx}`} className="my-3 border-border" />
            })}
        </div>
    )
}

/* ─── Component ─── */
export function GuidelineSearchPage() {
    const [query, setQuery] = useState("")
    const [isSearching, setIsSearching] = useState(false)
    const [result, setResult] = useState<SearchResult | null>(null)
    const [searchedQuery, setSearchedQuery] = useState("")
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null)

    const sourceCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleCitationClick = useCallback(
        (citationNo: number) => {
            if (!result) return
            const target = result.sources[citationNo - 1]
            if (!target) return

            setHighlightedSourceId(target.id)
            const el = sourceCardRefs.current[target.id]
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" })
            }

            if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
            highlightTimeoutRef.current = setTimeout(() => setHighlightedSourceId(null), 1800)
        },
        [result],
    )

    const handleSearch = useCallback(
        async (searchQuery?: string) => {
            const q = (searchQuery ?? query).trim()
            if (!q) return

            setIsSearching(true)
            setSearchedQuery(q)
            setErrorMessage(null)

            try {
                const res = await fetch("/api/guideline-search/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: q }),
                })

                const body = await res.json().catch(() => null)
                if (!res.ok || !body?.data) {
                    throw new Error(body?.message || "가이드라인 검색에 실패했습니다.")
                }

                const data = body.data as Partial<SearchResult>
                const sources = Array.isArray(data.sources) ? data.sources.map(normalizeSource) : []
                setResult({
                    query: data.query || q,
                    elapsed: data.elapsed || "0.00s",
                    sourceCount: typeof data.sourceCount === "number" ? data.sourceCount : sources.length,
                    summary: data.summary || "요약을 생성하지 못했습니다.",
                    detailedContent: data.detailedContent || "상세 내용을 생성하지 못했습니다.",
                    precautions: data.precautions || "주의사항을 생성하지 못했습니다.",
                    rawMarkdown: typeof data.rawMarkdown === "string" ? data.rawMarkdown : "",
                    sources,
                })
            } catch (err) {
                const message = err instanceof Error ? err.message : "검색 중 오류가 발생했습니다."
                setErrorMessage(message)
            } finally {
                setIsSearching(false)
            }
        },
        [query],
    )

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") void handleSearch()
    }

    const handleSuggestionClick = (label: string) => {
        setQuery(label)
        void handleSearch(label)
    }

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* ─── Search Header ─── */}
            <div
                className={cn(
                    "w-full transition-all duration-500 ease-in-out",
                    result ? "border-b border-border bg-card" : "flex flex-1 items-center justify-center",
                )}
            >
                <div className={cn("mx-auto w-full max-w-3xl px-6", result ? "py-5" : "py-0")}>
                    {/* Title — only show when no results */}
                    {!result && (
                        <div className="mb-8 flex flex-col items-center text-center">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                                <BookOpen className="h-7 w-7 text-primary" />
                            </div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                                지침서 검색기
                            </h1>
                            <p className="mt-2 text-sm text-muted-foreground">
                                RAG 기반 임상 지침 검색 · 근거문헌과 함께 답변을 제공합니다
                            </p>
                        </div>
                    )}

                    {/* Search Bar */}
                    <div className="relative flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="임상 질문을 입력하세요 (예: 투약량, 금기사항)..."
                                className={cn(
                                    "w-full rounded-xl border border-border bg-background py-3 pl-11 pr-4 text-sm outline-none transition-all",
                                    "placeholder:text-muted-foreground/60",
                                    "focus:border-primary/40 focus:ring-2 focus:ring-primary/10",
                                    result ? "rounded-xl" : "rounded-2xl py-3.5",
                                )}
                            />
                        </div>
                        <button
                            onClick={() => void handleSearch()}
                            disabled={isSearching || !query.trim()}
                            className={cn(
                                "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 font-medium text-primary-foreground transition-all",
                                "hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                                "active:scale-[0.97]",
                                result ? "h-[42px] text-sm" : "h-[46px] text-sm",
                            )}
                        >
                            {isSearching ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                            ) : (
                                "검색"
                            )}
                        </button>
                    </div>
                    {errorMessage && <p className="mt-2 text-xs text-destructive">{errorMessage}</p>}

                    {/* Suggested Queries — only show when no results */}
                    {!result && (
                        <div className="mt-6 flex flex-col items-center gap-3">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                추천 검색어
                            </span>
                            <div className="flex flex-wrap justify-center gap-2">
                                {SUGGESTED_QUERIES.map((sq) => (
                                    <button
                                        key={sq.label}
                                        onClick={() => handleSuggestionClick(sq.label)}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground",
                                            "transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm",
                                            "active:scale-[0.97]",
                                        )}
                                    >
                                        <span>{sq.icon}</span>
                                        {sq.label}
                                    </button>
                                ))}
                            </div>

                            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground/50">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>AI가 생성한 결과입니다. 최종 판단은 반드시 공식 가이드라인과 대조하세요.</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Results Area ─── */}
            {result && (
                <div className="flex-1 overflow-y-auto">
                    {/* Search meta bar */}
                    <div className="border-b border-border bg-muted/30 px-6 py-2.5">
                        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                                <Search className="h-3 w-3" />
                                &quot;{searchedQuery.toUpperCase()}&quot;
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {result.elapsed}
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {result.sourceCount} SOURCES FOUND
                            </span>
                        </div>
                    </div>

                    {/* Two-column layout */}
                    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:flex-row">
                        {/* Left: Guideline Summary */}
                        <div className="flex-1 min-w-0">
                            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                                <h2 className="mb-4 text-lg font-bold text-foreground">Guideline Answer</h2>

                                {result.rawMarkdown?.trim() ? (
                                    <GuidelineMarkdown markdown={result.rawMarkdown} onCitationClick={handleCitationClick} />
                                ) : (
                                    <div className="space-y-4">
                                        <div className="rounded-lg border border-amber-500/20 bg-amber-50/50 p-4 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                                            <div className="flex items-start gap-2">
                                                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                                <p className="leading-relaxed">
                                                    {renderInlineWithCitations(result.summary, handleCitationClick, "fallback-summary")}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                                            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                                                {renderInlineWithCitations(
                                                    result.detailedContent,
                                                    handleCitationClick,
                                                    "fallback-detail",
                                                )}
                                            </p>
                                        </div>

                                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                                            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                                                {renderInlineWithCitations(
                                                    result.precautions,
                                                    handleCitationClick,
                                                    "fallback-precaution",
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Clinical Judgment Warning */}
                                <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-orange-400/30 bg-orange-50/60 p-3 dark:bg-orange-950/20">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                                    <p className="text-xs leading-relaxed text-orange-800 dark:text-orange-300">
                                        <strong>Clinical Judgment Required:</strong> 이 요약은 AI가 로컬 가이드라인을 기반으로 생성한 것입니다.
                                        투약량·금기사항은 반드시 BNF/공식 지침과 대조하세요.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Right: Source Material */}
                        <div className="w-full shrink-0 lg:w-80 xl:w-96">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                                    Source Material
                                </h2>
                                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                                    {result.sources.length} Docs
                                </span>
                            </div>

                            <div className="flex flex-col gap-3">
                                {result.sources.map((src) => {
                                    const colorMap: Record<string, string> = {
                                        rose: "border-rose-500/20 bg-rose-50/50 dark:bg-rose-950/20",
                                        blue: "border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/20",
                                        emerald: "border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20",
                                        amber: "border-amber-500/20 bg-amber-50/50 dark:bg-amber-950/20",
                                        violet: "border-violet-500/20 bg-violet-50/50 dark:bg-violet-950/20",
                                    }
                                    const iconColorMap: Record<string, string> = {
                                        rose: "bg-rose-500/10 text-rose-600",
                                        blue: "bg-blue-500/10 text-blue-600",
                                        emerald: "bg-emerald-500/10 text-emerald-600",
                                        amber: "bg-amber-500/10 text-amber-600",
                                        violet: "bg-violet-500/10 text-violet-600",
                                    }

                                    return (
                                        <div
                                            key={src.id}
                                            ref={(el) => {
                                                sourceCardRefs.current[src.id] = el
                                            }}
                                            className={cn(
                                                "rounded-xl border p-4 transition-shadow hover:shadow-md",
                                                colorMap[src.color] ?? "border-border bg-card",
                                                highlightedSourceId === src.id && "ring-2 ring-primary/40",
                                            )}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div
                                                    className={cn(
                                                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm",
                                                        iconColorMap[src.color] ?? "bg-muted text-muted-foreground",
                                                    )}
                                                >
                                                    {src.icon}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="text-sm font-semibold text-foreground">{src.title}</h4>
                                                    <p className="text-xs text-muted-foreground">{src.section}</p>
                                                </div>
                                            </div>

                                            <blockquote className="mt-3 border-l-2 border-current/10 pl-3 text-xs italic leading-relaxed text-muted-foreground">
                                                &ldquo;{src.quote}&rdquo;
                                            </blockquote>

                                            <button
                                                className={cn(
                                                    "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground",
                                                    "transition-colors hover:bg-accent",
                                                )}
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                근거문헌
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
