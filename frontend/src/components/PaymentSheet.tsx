import { Check, Info, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../api/client";
import { onLive, useAuth } from "../context/AuthContext";
import { kes } from "../lib/format";
import type { Payment } from "../types";
import { Button, Modal, PhoneInput } from "./ui";

// M-Pesa checkout: confirm the number, we send the STK prompt, the person enters their PIN on
// their phone, and the result arrives over the live stream (with polling as a fallback).

type Started = { paymentId: string; simulated: boolean; message: string };

export function PaymentSheet({
  open,
  onClose,
  title,
  amount,
  summary,
  start,
  onPaid,
  doneLabel = "Done",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  amount: number;
  summary?: ReactNode;
  start: (phone: string) => Promise<Started>;
  onPaid: (p: Payment) => void;
  doneLabel?: string;
}) {
  const { me } = useAuth();
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"form" | "sending" | "waiting" | "paid" | "failed">("form");
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [left, setLeft] = useState(90);
  const pid = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhone(me?.phone ? me.phone.replace(/^\+254/, "0") : "");
      setStage("form");
      setError(null);
      setPayment(null);
      pid.current = null;
    }
  }, [open, me?.phone]);

  const finish = (p: Payment) => {
    if (p.id !== pid.current || p.status === "PENDING") return;
    setPayment(p);
    setStage(p.status === "SUCCESS" ? "paid" : "failed");
    if (p.status === "SUCCESS") onPaid(p);
  };

  // The result: pushed live, polled every 3 s in case the stream is down.
  useEffect(() => {
    if (stage !== "waiting") return;
    const off = onLive("payment", (p: Payment) => finish(p));
    const poll = setInterval(async () => {
      if (!pid.current) return;
      try {
        const r = await api.get<{ payment: Payment }>(`/mpesa/payments/${pid.current}`);
        finish(r.data.payment);
      } catch {
        /* keep waiting */
      }
    }, 3000);
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      off();
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const send = async () => {
    setError(null);
    if (!/^0[17]\d{8}$/.test(phone)) return setError("Enter a 10-digit Safaricom number, like 0712 345 678");
    setStage("sending");
    try {
      const s = await start(phone);
      pid.current = s.paymentId;
      setSimulated(s.simulated);
      setLeft(90);
      setStage("waiting");
    } catch (e) {
      setError(errorMessage(e));
      setStage("form");
    }
  };

  const busy = stage === "sending" || stage === "waiting";
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={stage === "paid" ? "Payment received" : stage === "failed" ? "Payment not completed" : title}>
      <div className="pay">
        {(stage === "form" || stage === "sending") && (
          <>
            {summary}
            <div className="pay-amount">
              <span className="mpesa-mark">
                <i /> M-Pesa
              </span>
              <span className="serif num">{kes(amount)}</span>
            </div>
            <PhoneInput value={phone} onChange={setPhone} error={error ?? undefined} hint="We'll send a payment prompt to this phone." autoFocus />
            <Button variant="primary" size="lg" block loading={stage === "sending"} onClick={send}>
              Send M-Pesa prompt
            </Button>
          </>
        )}

        {stage === "waiting" && (
          <>
            <div className="phone-wait">
              <div className="phone">
                <span className="phone-ring" />
                <div className="phone-screen">
                  <div className="phone-prompt">
                    <b>M-Pesa</b>
                    Pay {kes(amount)} to KONNECT?
                    <div className="pin">
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="stack g-6 center">
              <div className="h-2">Check your phone</div>
              <p className="soft small">
                Enter your M-Pesa PIN on {phone.replace(/^0(\d{3})(\d{3})(\d{3})$/, "0$1 $2 $3")} to pay {kes(amount)}.
              </p>
            </div>
            <div className="progress-line">
              <i style={{ width: `${(left / 90) * 100}%` }} />
            </div>
            {simulated && (
              <div className="notice">
                <Info />
                <span>Payments are in test mode: this confirms by itself in a few seconds and no money moves.</span>
              </div>
            )}
            {left === 0 && (
              <Button variant="ghost" onClick={() => setStage("form")} icon={<RotateCcw />}>
                Send a new prompt
              </Button>
            )}
          </>
        )}

        {stage === "paid" && payment && (
          <>
            <div className="pay-done">
              <Check />
            </div>
            <div className="stack g-6 center">
              <div className="display d-4">{kes(payment.amount)}</div>
              <p className="soft small">{payment.receipt ? `M-Pesa receipt ${payment.receipt}` : "Confirmed by M-Pesa"}</p>
            </div>
            <Button variant="ink" size="lg" block onClick={onClose}>
              {doneLabel}
            </Button>
          </>
        )}

        {stage === "failed" && (
          <>
            <div className="pay-done fail">
              <X />
            </div>
            <p className="center soft">{payment?.message ?? "M-Pesa could not complete the payment."}</p>
            <div className="row g-8">
              <Button variant="outline" block onClick={onClose}>
                Close
              </Button>
              <Button variant="primary" block onClick={() => setStage("form")}>
                Try again
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
