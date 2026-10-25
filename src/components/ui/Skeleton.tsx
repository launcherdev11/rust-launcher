type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-white/10 ${className}`}
      aria-hidden="true"
    />
  );
}

export function CatalogCardSkeleton({
  layout = "grid",
}: {
  layout?: "list" | "grid";
}) {
  if (layout === "list") {
    return (
      <div className="flex items-stretch gap-3 rounded-2xl border border-white/10 bg-black/35 px-3 py-3">
        <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <Skeleton className="h-4 w-2/3 max-w-[12rem]" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/35 px-3 py-3">
      <Skeleton className="h-12 w-12 rounded-xl" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function FriendRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-3.5 py-3">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-8 w-16 rounded-lg" />
    </div>
  );
}

export function RoomCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}
