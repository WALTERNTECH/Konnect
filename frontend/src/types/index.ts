// Shapes of the API's responses, mirrored from backend/src/services/views.ts and the routes.

export type Badges = { phone: boolean; id: boolean; income: boolean; background: boolean };

export type Me = {
  id: string;
  fullName: string;
  firstName: string;
  email: string;
  phone: string;
  gender: "woman" | "man" | "nonbinary";
  dateOfBirth: string;
  age: number;
  bio: string;
  photoUrl: string | null;
  city: string;
  neighbourhood: string | null;
  phoneVerified: boolean;
  phoneVerificationRequired: boolean;
  badges: Badges;
  /** Where a host's 85% of each booking is sent. */
  payoutPhone: string;
  trustedContact: { name: string; phone: string } | null;
  prefs: { sms: boolean; matches: boolean; messages: boolean; reminders: boolean };
  isHost: boolean;
  hasConnectProfile: boolean;
  verification: Partial<Record<"ID" | "INCOME" | "BACKGROUND", "PENDING" | "APPROVED" | "REJECTED">>;
  unread: { notifications: number; messages: number };
  createdAt: string;
};

export type ListingType = "STAY" | "WELLNESS";

export type ListingCard = {
  id: string;
  type: ListingType;
  title: string;
  summary: string;
  city: string;
  neighbourhood: string;
  priceKes: number;
  unit: "night" | "session";
  bedrooms: number | null;
  maxGuests: number | null;
  category: string | null;
  durationMin: number | null;
  serviceModes: ("home" | "studio")[];
  photos: string[];
  rating: number;
  reviews: number;
  featured: boolean;
  sample: boolean;
  status: string;
  /** Stays only: free now, or occupied until a check-out time. */
  availability: { status: "available" | "occupied"; until: string | null } | null;
};

export type ListingDetail = ListingCard & {
  description: string;
  bathrooms: number | null;
  minNights: number;
  checkInTime: string | null;
  checkOutTime: string | null;
  houseRules: string;
  depositPct: number | null;
  hours: Record<string, [string, string]> | null;
  amenities: string[];
  rejectionReason?: string | null;
  featuredUntil?: string | null;
  mine: boolean;
};

export type Host = { id: string; name: string; photoUrl: string | null; bio: string; since: string; badges: Badges; level: "New" | "Trusted" | "Top Rated"; listings: number };

export type Review = { id: string; rating: number; body: string; host_reply: string | null; created_at: string; author: string; author_photo: string | null };

export type Booking = {
  id: string;
  ref: string;
  kind: ListingType;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "EXPIRED";
  role: "guest" | "host";
  listing: { id: string; title: string; photo: string | null; neighbourhood: string; city: string; category: string | null; durationMin: number | null };
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  guests: number;
  serviceMode: "home" | "studio" | null;
  visitAddress: string | null;
  price: { unit: number; subtotal: number; total: number; dueNow: number; payLater: number; payMode: "full" | "deposit"; commission?: number; hostReceives?: number };
  payout: { status: "QUEUED" | "SENDING" | "PAID" | "FAILED" | "HELD"; amount: number; reference: string | null; phone: string } | null;
  notes: string;
  holdUntil: string | null;
  receipt: string | null;
  reviewed: boolean;
  canReview: boolean;
  counterpart: { name: string; phone: string | null; photoUrl?: string | null };
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type Payment = { id: string; purpose: string; refId: string | null; amount: number; status: "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED"; receipt: string | null; message: string; simulated: boolean };

export type ConnectCard = {
  userId: string;
  name: string;
  age: number;
  gender: string;
  city: string;
  neighbourhood: string | null;
  headline: string;
  intent: "relationship" | "dating" | "friendship" | "arrangement";
  arrangementRole: "benefactor" | "seeking" | null;
  interests: string[];
  occupation: string;
  photos: string[];
  badges: Badges;
  lastSeen: string;
  liked: boolean;
  likedYou: boolean;
};
export type ConnectProfile = ConnectCard & { bio: string; matchId: string | null; online: boolean };

export type MyConnectProfile = {
  headline: string;
  intent: ConnectCard["intent"];
  arrangementRole: ConnectCard["arrangementRole"];
  interestedIn: string[];
  ageMin: number;
  ageMax: number;
  interests: string[];
  occupation: string;
  visible: boolean;
  photos: string[];
};

export type Thread = {
  matchId: string;
  user: { id: string; name: string; photoUrl: string | null; verified: boolean; online: boolean; lastSeen: string };
  last: { content: string; senderId: string; createdAt: string } | null;
  unread: number;
  createdAt: string;
};
export type Message = { id: string; senderId: string; content: string; isRead: boolean; createdAt: string };

export type Notification = { id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string };

export type Ad = { id: string; advertiser: string; headline: string; text: string; imageUrl: string | null; cta: string; url: string; house: boolean };
