type SponsorBadgeProps = {
  title: string;
  className?: string;
};


export function SponsorBadge({ title, className = "" }: SponsorBadgeProps) {
  return (
    <img
      src="/launcher-assets/sponsor.png"
      alt=""
      title={title}
      aria-label={title}
      className={`inline-block h-9 w-9 shrink-0 object-contain align-[-3px] ${className}`}
      draggable={false}
    />
  );
}

type NicknameWithSponsorProps = {
  nickname: string;
  isSponsor?: boolean | null;
  sponsorTitle: string;
  className?: string;
  as?: "p" | "span";
};

export function NicknameWithSponsor({
  nickname,
  isSponsor,
  sponsorTitle,
  className = "truncate text-sm font-semibold text-white/90",
  as = "p",
}: NicknameWithSponsorProps) {
  const Tag = as;
  return (
    <Tag className={`inline-flex max-w-full items-center gap-0.1 ${className}`}>
      <span className="truncate">{nickname}</span>
      {isSponsor ? <SponsorBadge title={sponsorTitle} /> : null}
    </Tag>
  );
}
