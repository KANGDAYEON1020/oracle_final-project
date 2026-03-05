import { Suspense } from "react"

import IsolationChecklistPageClient from "./page-client"

function IsolationChecklistPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      로딩 중...
    </div>
  )
}

export default function IsolationChecklistPage() {
  return (
    <Suspense fallback={<IsolationChecklistPageFallback />}>
      <IsolationChecklistPageClient />
    </Suspense>
  )
}
