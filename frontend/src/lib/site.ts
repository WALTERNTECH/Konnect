import { useApi } from "../api/client";

// The control centre's switches as the site sees them.

export type Site = {
  banner: string | null;
  signupsOpen: boolean;
  bookingsOpen: boolean;
  connectOpen: boolean;
  wellnessOpen: boolean;
  commissionPct: number;
  supportPhone: string | null;
};

const OPEN: Site = { banner: null, signupsOpen: true, bookingsOpen: true, connectOpen: true, wellnessOpen: true, commissionPct: 15, supportPhone: null };

export function useSite(): Site {
  return useApi<Site>("/site", { staleMs: 15_000 }).data ?? OPEN;
}
