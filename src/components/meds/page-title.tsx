/** A page's heading row: title and one line on what the page is for, actions on the right. */
export function PageTitle({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">{children}</div>}
    </div>
  );
}

/** Placeholder cards while a page's data loads. */
export function CardsSkeleton({ count = 3, className = "sm:grid-cols-2 xl:grid-cols-3" }: { count?: number; className?: string }) {
  return (
    <div className={`grid gap-4 ${className}`} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
