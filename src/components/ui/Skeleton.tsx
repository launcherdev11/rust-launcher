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

export function BannerSkeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`relative flex h-full w-full flex-col justify-center overflow-hidden px-8 py-6 ${className}`}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-white/5 via-white/10 to-white/5" />
      <Skeleton className="relative z-10 h-6 w-48 rounded-lg" />
      <Skeleton className="relative z-10 mt-3 h-3.5 w-80 max-w-full rounded-lg" />
      <Skeleton className="relative z-10 mt-2 h-3.5 w-56 max-w-full rounded-lg" />
      <div className="relative z-10 mt-5 flex gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
    </div>
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
