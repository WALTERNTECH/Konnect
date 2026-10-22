import { MapPinned, MessageCircle, ScanFace, ShieldBan, Siren, UserCheck } from "lucide-react";
import { LinkButton, PageHead } from "../components/ui";

export function SafetyPage() {
  const items = [
    [<UserCheck key="i" />, "Confirmed phone numbers", "Every account's phone number is confirmed by SMS. ID, income and background badges are added only after the team reviews documents."],
    [<MessageCircle key="i" />, "Messages after a mutual like", "No one can message you in Connect unless you've both liked each other. You can unmatch at any time."],
    [<MapPinned key="i" />, "Share a meetup", "From any conversation, send a trusted contact a text with where and when you're meeting, and who with."],
    [<Siren key="i" />, "SOS", "One tap texts your trusted contact your location and alerts the Konnect safety team."],
    [<ShieldBan key="i" />, "Block and report", "Blocking ends a conversation and hides you from each other. Reports go to a person on the safety team. Anyone reported by several members, or as possibly under 18, is hidden from Connect until reviewed."],
    [<ScanFace key="i" />, "Adults only", "Konnect is for people aged 18 and over. Date of birth is checked at sign-up, and accounts that appear to belong to a minor are closed."],
  ] as const;
  return (
    <div className="page page-mid">
      <PageHead eyebrow="Safety" title="How Konnect keeps people safe">
        Meet in public the first few times, tell someone you trust where you'll be, and keep payments inside Konnect. Never send money to someone you met on Connect.
      </PageHead>
      <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {items.map(([icon, t, d]) => (
          <div key={t} className="card card-pad stack g-10">
            <span style={{ color: "var(--accent)" }}>{icon}</span>
            <span className="h-2">{t}</span>
            <span className="small soft">{d}</span>
          </div>
        ))}
      </div>
      <div className="row g-8 mt-32">
        <LinkButton to="/account/safety" variant="ink">
          Set a trusted contact
        </LinkButton>
      </div>
    </div>
  );
}

function Doc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page page-narrow">
      <PageHead eyebrow="Konnect" title={title} />
      <div className="stack g-16 soft" style={{ lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}

export function Terms() {
  return (
    <Doc title="Terms">
      <p>These terms cover your use of Konnect, a service for booking short stays and wellness sessions and for meeting other members.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Who can use Konnect</h2>
      <p>You must be 18 or older and give accurate details, including your date of birth and phone number. One account per person.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Bookings</h2>
      <p>A booking is confirmed when M-Pesa confirms your payment. Paid bookings can be cancelled up to 48 hours before they start for a refund to the paying M-Pesa number. The booking fee covers payment handling and support. Hosts and practitioners are responsible for the accuracy of their listings and for the service they provide.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Membership and Connect</h2>
      <p>Membership is paid in advance for 30 or 365 days and does not renew on its own. Connect is a social service for adults to meet one another. Offering or requesting sexual services, or money in exchange for company, is not allowed and leads to account closure.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Conduct</h2>
      <p>No harassment, impersonation, scams or content involving anyone under 18. Konnect may suspend or close accounts that break these terms and will cooperate with lawful requests from the authorities.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Payments</h2>
      <p>All payments are made by M-Pesa. Payouts to hosts are sent to their registered M-Pesa number after check-in or the appointment.</p>
    </Doc>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy notice">
      <p>Konnect processes personal data in line with Kenya's Data Protection Act, 2019.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>What we keep</h2>
      <p>Your name, contact details, date of birth, profile and photos; bookings and payments; messages between matched members; and verification documents you choose to send.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Who sees it</h2>
      <p>Other members see your first name, age, neighbourhood, photos and what you write in your profile. Your phone number and email are never shown in Connect. A host or practitioner sees your name and phone once your booking is paid. Verification documents are seen only by the verification team.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>How long</h2>
      <p>Closing your account removes your profile, photos and matches. Booking and payment records are kept for as long as the law requires for financial records.</p>
      <h2 className="h-2" style={{ color: "var(--ink)" }}>Your rights</h2>
      <p>You can see and correct your data in Account, and ask for a copy or deletion by contacting support.</p>
    </Doc>
  );
}
