import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { searchUsers, type UserSearchRow } from "../../api/users";
import { AssetIcon } from "../../components/asset_icon";
import { SponsorBadge } from "../../components/SponsorBadge";
import { Spinner } from "../../components/ui/Spinner";
import { buildInitialAvatarDataUrl } from "../../lib/avatar";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 220;

export function useNicknameSuggestions(query: string, enabled: boolean) {
  const [results, setResults] = useState<UserSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [settledQuery, setSettledQuery] = useState("");

  const needle = query.trim();
  const active = enabled && needle.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!active) {
      setResults([]);
      setLoading(false);
      setSettledQuery("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchUsers(needle, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          setResults(rows);
          setSettledQuery(needle);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setSettledQuery(needle);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, needle]);

  const markRequestSent = (userId: string) => {
    setResults((prev) =>
      prev.map((row) => (row.user_id === userId ? { ...row, request_sent: true } : row)),
    );
  };

  return { results, loading, settledQuery, active, markRequestSent };
}

function HighlightedNickname({ nickname, query }: { nickname: string; query: string }) {
  const at = query ? nickname.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <span className="truncate">{nickname}</span>;
  return (
    <span className="truncate">
      {nickname.slice(0, at)}
      <span className="text-accent-hi">{nickname.slice(at, at + query.length)}</span>
      {nickname.slice(at + query.length)}
    </span>
  );
}

type Props = {
  open: boolean;
  tt: Tt;
  query: string;
  results: UserSearchRow[];
  loading: boolean;
  settledQuery: string;
  highlighted: number;
  busyUserId: string | null;
  onHover: (index: number) => void;
  onPick: (row: UserSearchRow) => void;
  onAdd: (row: UserSearchRow) => void;
};

export function NicknameSuggestions({
  open,
  tt,
  query,
  results,
  loading,
  settledQuery,
  highlighted,
  busyUserId,
  onHover,
  onPick,
  onAdd,
}: Props) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const showEmpty = !loading && settledQuery === query.trim() && results.length === 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="nickname-suggestions"
          initial={{ opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
          style={{ transformOrigin: "top center" }}
          className="glass-popover absolute left-0 right-0 top-[calc(100%+0.375rem)] z-30 overflow-hidden p-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5">
            <span className="ui-caption">{tt("friends.suggest.title")}</span>
            {loading ? <Spinner className="h-3.5 w-3.5 text-white/40" /> : null}
          </div>

          {results.length > 0 ? (
            <ul
              ref={listRef}
              role="listbox"
              className="custom-scrollbar flex max-h-64 flex-col gap-0.5 overflow-y-auto"
            >
              {results.map((row, index) => {
                const selected = index === highlighted;
                const canAdd = !row.is_friend && !row.request_sent;
                return (
                  <motion.li
                    key={row.user_id}
                    role="option"
                    aria-selected={selected}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index, 6) * 0.025, ease: [0.2, 0.9, 0.25, 1] }}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onPick(row)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                      selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <img
                      src={buildInitialAvatarDataUrl(row.nickname)}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full ring-1 ring-white/15"
                      draggable={false}
                    />
                    <span className="flex min-w-0 flex-1 items-center text-sm font-medium text-white/90">
                      <HighlightedNickname nickname={row.nickname} query={query.trim()} />
                      {row.is_sponsor ? (
                        <SponsorBadge title={tt("common.sponsor")} className="!h-6 !w-6" />
                      ) : null}
                    </span>
                    {row.is_friend ? (
                      <span className="tag shrink-0 bg-emerald-500/15 text-emerald-200">
                        {tt("friends.suggest.isFriend")}
                      </span>
                    ) : row.request_sent ? (
                      <span className="tag shrink-0">{tt("friends.suggest.requestSent")}</span>
                    ) : null}
                    {canAdd ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-tint h-7 shrink-0 gap-1.5 px-2.5"
                        disabled={busyUserId === row.user_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdd(row);
                        }}
                      >
                        {busyUserId === row.user_id ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <AssetIcon name="add_freind" className="h-3.5 w-3.5" />
                        )}
                        {tt("friends.suggest.add")}
                      </button>
                    ) : null}
                  </motion.li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2.5 pb-2 pt-0.5 text-[0.8125rem] text-white/45">
              {showEmpty ? tt("friends.suggest.empty") : tt("friends.suggest.searching")}
            </p>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
