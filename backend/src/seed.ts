import { randomBytes } from "node:crypto";
import { one, type Db } from "./config/db.js";
import { hashPassword } from "./utils/security.js";

// Sample stays and wellness listings so a new deployment isn't empty. They are marked as
// samples everywhere they appear, can only be booked while payments are simulated, and the
// admin console removes them in one action. There are deliberately no sample people in
// Connect and no sample reviews.

type Sample = Record<string, unknown> & { key: string; photos: number };

const HOURS = { "1": ["09:00", "19:00"], "2": ["09:00", "19:00"], "3": ["09:00", "19:00"], "4": ["09:00", "19:00"], "5": ["09:00", "19:00"], "6": ["09:00", "19:00"], "7": ["10:00", "16:00"] };

const STAYS: Sample[] = [
  { key: "kilimani", photos: 3, title: "Light-filled one-bedroom", neighbourhood: "Kilimani", city: "Nairobi", price_kes: 6500, bedrooms: 1, bathrooms: 1, max_guests: 2,
    summary: "A quiet fourth-floor apartment with a full kitchen and a desk by the window.",
    description: "A one-bedroom apartment on a tree-lined street, ten minutes from Yaya and Adlife. The bedroom faces east and gets the morning light; the living room has a desk that seats one comfortably for a working day. The kitchen is fully equipped, and there is a backup generator for the whole building.\n\nCheck-in is self-service with a lockbox. Parking is in the basement.",
    amenities: ["Wi-Fi", "Workspace", "Kitchen", "Backup power", "Hot shower", "Security", "Smart TV", "Parking"], check_in_time: "14:00", check_out_time: "10:00" },
  { key: "westlands", photos: 3, title: "Penthouse with a city view", neighbourhood: "Westlands", city: "Nairobi", price_kes: 18000, bedrooms: 2, bathrooms: 2, max_guests: 4,
    summary: "Top-floor, glass on three sides, with a gym and pool in the building.",
    description: "A two-bedroom penthouse above Westlands with floor-to-ceiling glass and a long view toward the Ngong Hills on a clear evening. Both bedrooms have their own bathroom. The building has a lap pool, a gym and round-the-clock security.\n\nGood for visiting colleagues or a weekend in town.",
    amenities: ["Wi-Fi", "Workspace", "Kitchen", "Parking", "Gym", "Pool", "Backup power", "City view", "Air conditioning", "Security"], check_in_time: "14:00", check_out_time: "11:00" },
  { key: "karen", photos: 3, title: "Garden cottage under the trees", neighbourhood: "Karen", city: "Nairobi", price_kes: 9500, bedrooms: 1, bathrooms: 1, max_guests: 2, min_nights: 2,
    summary: "A stone cottage in an acre of garden, close to the Giraffe Centre.",
    description: "A self-contained stone cottage set apart from the main house in a mature garden. There is a fireplace for cold evenings, a veranda for breakfast, and enough quiet to forget the city is twenty minutes away.\n\nTwo-night minimum.",
    amenities: ["Garden", "Parking", "Wi-Fi", "Kitchen", "Hot shower", "Security"], check_in_time: "14:00", check_out_time: "11:00" },
  { key: "lavington", photos: 3, title: "Two bedrooms with a roof terrace", neighbourhood: "Lavington", city: "Nairobi", price_kes: 12000, bedrooms: 2, bathrooms: 2, max_guests: 4,
    summary: "A bright duplex with a private terrace for long dinners.",
    description: "A duplex apartment with two en-suite bedrooms upstairs and an open living and dining floor below. The roof terrace is private to this unit and set up for eight.\n\nThe washer and dryer make it easy for a longer stay.",
    amenities: ["Balcony", "Wi-Fi", "Kitchen", "Parking", "Washer", "Backup power", "Hot shower"], check_in_time: "14:00", check_out_time: "10:00" },
  { key: "kileleshwa", photos: 3, title: "Studio for short work trips", neighbourhood: "Kileleshwa", city: "Nairobi", price_kes: 4500, bedrooms: 0, bathrooms: 1, max_guests: 2,
    summary: "A compact studio with a proper desk and fast fibre.",
    description: "A well-planned studio with a queen bed, a kitchenette and a desk with a monitor. Fibre internet and backup power mean a working day goes uninterrupted.\n\nShops and cafés are a short walk away.",
    amenities: ["Wi-Fi", "Workspace", "Kitchen", "Backup power", "Hot shower", "Security"], check_in_time: "13:00", check_out_time: "10:00" },
  { key: "nyali", photos: 3, title: "Ocean-view apartment", neighbourhood: "Nyali", city: "Mombasa", price_kes: 11000, bedrooms: 2, bathrooms: 2, max_guests: 4,
    summary: "Two bedrooms and a balcony over the Indian Ocean.",
    description: "A two-bedroom apartment with a balcony facing the sea. The beach is a two-minute walk through the complex gardens, and there is a pool for the afternoons when the tide is out.\n\nAir conditioning in every room.",
    amenities: ["Ocean view", "Pool", "Air conditioning", "Wi-Fi", "Kitchen", "Parking", "Balcony", "Security"], check_in_time: "14:00", check_out_time: "10:00" },
  { key: "diani", photos: 3, title: "Villa with a private pool", neighbourhood: "Diani", city: "Mombasa", price_kes: 32000, bedrooms: 4, bathrooms: 4, max_guests: 8, min_nights: 2,
    summary: "Four bedrooms around a private pool, five minutes from the beach.",
    description: "A whitewashed villa with four en-suite bedrooms arranged around a private pool and an outdoor living room. A housekeeper comes in each morning; a cook can be arranged.\n\nTwo-night minimum.",
    amenities: ["Pool", "Garden", "Air conditioning", "Kitchen", "Parking", "Security", "Wi-Fi", "Washer"], check_in_time: "14:00", check_out_time: "11:00" },
  { key: "riverside", photos: 3, title: "Executive suite", neighbourhood: "Riverside", city: "Nairobi", price_kes: 8000, bedrooms: 1, bathrooms: 1, max_guests: 2,
    summary: "A serviced one-bedroom with a gym downstairs.",
    description: "A serviced suite in a modern block on Riverside Drive, with daily housekeeping, a gym and a residents' lounge. The bedroom has blackout curtains and a work desk.\n\nClose to the Westlands offices.",
    amenities: ["Gym", "Wi-Fi", "Workspace", "Kitchen", "Parking", "Air conditioning", "Security"], check_in_time: "14:00", check_out_time: "11:00" },
  { key: "runda", photos: 3, title: "Family home with a pool", neighbourhood: "Runda", city: "Nairobi", price_kes: 26000, bedrooms: 4, bathrooms: 3, max_guests: 8, min_nights: 2,
    summary: "A four-bedroom house with a pool and a large lawn.",
    description: "A four-bedroom family house in a gated community, with a heated pool, a large lawn and a covered terrace. The kitchen is set up for cooking for a group.\n\nTwo-night minimum.",
    amenities: ["Pool", "Garden", "Parking", "Kitchen", "Washer", "Security", "Backup power", "Wi-Fi"], check_in_time: "14:00", check_out_time: "11:00" },
  { key: "gigiri", photos: 3, title: "Calm apartment near the UN", neighbourhood: "Gigiri", city: "Nairobi", price_kes: 7500, bedrooms: 1, bathrooms: 1, max_guests: 2,
    summary: "A minimalist one-bedroom in a quiet compound.",
    description: "A calm, uncluttered one-bedroom in a small compound, a short drive from the UN complex and Village Market. The kitchen opens onto a small garden.\n\nSecure parking for one car.",
    amenities: ["Wi-Fi", "Kitchen", "Parking", "Garden", "Hot shower", "Security"], check_in_time: "14:00", check_out_time: "10:00" },
];

const WELLNESS: Sample[] = [
  { key: "deeptissue", photos: 2, title: "Deep tissue massage", neighbourhood: "Kilimani", city: "Nairobi", price_kes: 4500, category: "massage", duration_min: 75, service_modes: ["studio", "home"], deposit_pct: 30,
    summary: "Seventy-five minutes of slow, firm work on the back, shoulders and legs.",
    description: "A deep tissue session for tight shoulders, lower back pain and the long-desk-day stiffness. The therapist checks pressure as they go and works the areas you name at the start.\n\nStudio sessions are in Kilimani. Home visits bring a table, linen and oils." },
  { key: "hotstone", photos: 2, title: "Hot stone therapy", neighbourhood: "Westlands", city: "Nairobi", price_kes: 6000, category: "spa", duration_min: 90, service_modes: ["studio"], deposit_pct: 0,
    summary: "Ninety minutes with heated basalt stones and a warm oil massage.",
    description: "Heated basalt stones are placed along the spine and used to massage the back, legs and arms, followed by a short steam. Recommended for stress and poor sleep.\n\nStudio only, in Westlands." },
  { key: "sports", photos: 2, title: "Sports massage at home", neighbourhood: "Lavington", city: "Nairobi", price_kes: 5000, category: "massage", duration_min: 60, service_modes: ["home"], deposit_pct: 30,
    summary: "Recovery work for runners, footballers and gym regulars.",
    description: "A sports massage focused on recovery and range of movement: legs, hips and shoulders, with stretching at the end. Home visits across Lavington, Kileleshwa, Westlands and Kilimani." },
  { key: "physio", photos: 2, title: "Physiotherapy assessment", neighbourhood: "Upper Hill", city: "Nairobi", price_kes: 3500, category: "physiotherapy", duration_min: 45, service_modes: ["studio"], deposit_pct: 0,
    summary: "An assessment and treatment plan from a registered physiotherapist.",
    description: "A first appointment for back, neck, knee or sports injuries: history, assessment, hands-on treatment and a written exercise plan. Bring any scans or reports you have.\n\nClinic in Upper Hill." },
  { key: "facial", photos: 2, title: "Signature facial", neighbourhood: "Lavington", city: "Nairobi", price_kes: 5500, category: "beauty", duration_min: 60, service_modes: ["studio"], deposit_pct: 0,
    summary: "Cleanse, exfoliation, extraction and a mask chosen for your skin.",
    description: "An hour-long facial that starts with a skin consultation, then cleanse, exfoliation, gentle extraction, a mask and a face and shoulder massage." },
  { key: "nails", photos: 2, title: "Manicure and pedicure at home", neighbourhood: "Kileleshwa", city: "Nairobi", price_kes: 2800, category: "beauty", duration_min: 90, service_modes: ["home"], deposit_pct: 30,
    summary: "Hands and feet, with gel or classic polish, wherever you are.",
    description: "A full manicure and pedicure at your home or hotel, with gel or classic polish. Tools are sterilised between every client." },
  { key: "aroma", photos: 2, title: "Aromatherapy massage", neighbourhood: "Karen", city: "Nairobi", price_kes: 5000, category: "massage", duration_min: 60, service_modes: ["studio", "home"], deposit_pct: 30,
    summary: "A gentle full-body massage with essential oils.",
    description: "A slow, light-pressure massage with a blend of essential oils chosen at the start of the session. Studio sessions in a garden room in Karen." },
  { key: "sauna", photos: 2, title: "Sauna and steam", neighbourhood: "Nyali", city: "Mombasa", price_kes: 2500, category: "spa", duration_min: 60, service_modes: ["studio"], deposit_pct: 0,
    summary: "An hour in the sauna and steam room, with the pool after.",
    description: "Use of the cedar sauna, the steam room and the pool for an hour, with towels and a robe. Booked as a private slot so you have the rooms to yourself." },
];

export async function seedSamples(db: Db, log: (m: string) => void = () => {}) {
  const removed = await one(db, `select 1 from settings where key = 'samples_removed'`);
  if (removed) return;
  const exists = await one(db, `select 1 from users where is_sample limit 1`);
  if (exists) return;
  await db.tx(async (q) => {
    const host = await one<{ id: string }>(
      q,
      `insert into users (email, phone, payout_phone, password_hash, full_name, date_of_birth, gender, referral_code, is_sample, phone_verified_at, id_verified_at, bio)
       values ('samples@konnect.invalid', '+254700000000', '+254700000000', $1, 'Konnect Collection', '1990-01-01', 'nonbinary', 'KSAMPLE', true, now(), now(), $2) returning id`,
      [await hashPassword(randomBytes(24).toString("hex")), "Sample listings that show how Konnect works. Real hosts and practitioners replace them."],
    );
    for (const [type, list] of [["STAY", STAYS], ["WELLNESS", WELLNESS]] as const) {
      for (const s of list) {
        const { key, photos, ...cols } = s;
        const row = {
          ...cols,
          type,
          host_id: host!.id,
          status: "APPROVED",
          is_sample: true,
          photos: Array.from({ length: photos }, (_, i) => `/samples/${key}-${i + 1}-1600.webp`),
          ...(type === "WELLNESS" ? { hours: JSON.stringify(HOURS) } : {}),
        };
        const keys = Object.keys(row);
        await q.query(`insert into listings (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
      }
    }
    await q.query(
      `insert into ads (advertiser, headline, ad_text, cta_label, target_url, is_house, status)
       values ('Konnect', 'Host on Konnect', 'List your apartment or villa. When a guest pays, 85% goes straight to your M-Pesa.', 'Start hosting', '/host', true, 'ACTIVE')`,
    );
  });
  log(`seeded ${STAYS.length} sample stays and ${WELLNESS.length} sample wellness listings`);
}
