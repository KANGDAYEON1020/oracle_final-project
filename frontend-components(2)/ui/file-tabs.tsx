'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@/lib/utils'

interface FileTabsContextValue {
  value?: string
}

const FileTabsContext = React.createContext<FileTabsContextValue>({})

function FileTabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <FileTabsContext.Provider value={{ value: props.value }}>
      <TabsPrimitive.Root className={cn('flex flex-col', className)} {...props} />
    </FileTabsContext.Provider>
  )
}

function FileTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'relative flex w-fit items-end gap-0.5 border-b border-border',
        className,
      )}
      {...props}
    />
  )
}

function FileTab({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const context = React.useContext(FileTabsContext)
  const isActive = context.value === value

  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'relative flex items-center justify-center px-4 py-2 text-[13px] font-normal transition-all duration-150',
        'border border-border rounded-t-lg -mb-px',
        'hover:bg-muted/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
        'disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-background text-foreground font-semibold border-b-background z-10 shadow-sm'
          : 'bg-muted/30 text-muted-foreground border-b-border z-0',
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
}

function FileTabPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'mt-0 rounded-b-xl rounded-tr-xl border border-t-0 border-border bg-background p-4',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:zoom-in-95',
        className,
      )}
      {...props}
    />
  )
}

export { FileTabs, FileTabsList, FileTab, FileTabPanel }
