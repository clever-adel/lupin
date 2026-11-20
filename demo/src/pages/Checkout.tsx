import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FREE_DELIVERY_OVER, GOVERNORATES, egp, findProduct } from "../data";
import { I, ProductVisual } from "../components/ui";
import { useStore, type DemoOrder } from "../store";

// Checkout simulation. Details typed here stay in this component's memory only: nothing is saved,
// sent or logged, and they are gone when the page changes. The Paymob step is a visual stand-in
// with fixed sample values — it has no fields for a real card number or wallet.

interface Details { name: string; phone: string; email: string; governorate: string; city: string; address: string; notes: string }
const EMPTY: Details = { name: "", phone: "", email: "", governorate: "", city: "", address: "", notes: "" };
const SAMPLE: Details = { name: "Demo Customer", phone: "01000000000", email: "demo@example.com", governorate: "Cairo", city: "Zamalek", address: "12 Sample Street, Apt 4", notes: "" };

type Step = 1 | 2 | 3;
type Method = "card" | "wallet";

export default function Checkout() {
  const { cart, subtotal, delivery, placeOrder } = useStore();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [d, setD] = useState<Details>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const [method, setMethod] = useState<Method>("card");
  const [phase, setPhase] = useState<"idle" | "processing" | "otp" | "done">("idle");
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [otp, setOtp] = useState("");

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step, order]);

  if (order) return <Confirmation order={order} name={d.name} />;

  if (cart.length === 0) {
    return (
      <div className="page wrap narrow center">
        <h1 className="h1">Checkout</h1>
        <p className="muted">Your cart is empty — add a piece to try the checkout simulation.</p>
        <Link to="/shop" className="btn btn-dark">Shop the collection</Link>
      </div>
    );
  }

  const total = subtotal + delivery;
  const field = (k: keyof Details) => ({
    id: `f-${k}`,
    value: d[k],
    onChange: (e: { target: { value: string } }) => { setD({ ...d, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); },
    "aria-invalid": !!errors[k],
    "aria-describedby": errors[k] ? `e-${k}` : undefined,
  });

  const validate = () => {
    const e: typeof errors = {};
    if (d.name.trim().length < 3) e.name = "Enter your full name.";
    if (!/^01[0125]\d{8}$/.test(d.phone.replace(/\s/g, ""))) e.phone = "Enter an Egyptian mobile number, e.g. 010 0000 0000.";
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = "Check the email address.";
    if (!d.governorate) e.governorate = "Choose a governorate.";
    if (d.city.trim().length < 2) e.city = "Enter your city or area.";
    if (d.address.trim().length < 6) e.address = "Enter street, building and apartment.";
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) document.getElementById(`f-${first}`)?.focus();
    return !first;
  };

  const next = (e: FormEvent) => { e.preventDefault(); if (step === 1 && validate()) setStep(2); else if (step === 2) setStep(3); };

  const pay = () => {
    setPhase("processing");
    setTimeout(() => setPhase(method === "card" ? "otp" : "processing"), 1400);
    if (method === "wallet") setTimeout(finish, 2600);
  };
  const finish = () => {
    setPhase("done");
    setOrder(placeOrder(method === "card" ? "Card via Paymob (simulated)" : "Mobile wallet via Paymob (simulated)"));
  };

  const Err = ({ k }: { k: keyof Details }) => (errors[k] ? <span id={`e-${k}`} className="field-err">{errors[k]}</span> : null);

  return (
    <div className="page checkout wrap">
      <div className="co-banner" role="note"><I.lock width={16} /> <strong>Checkout simulation.</strong> No payment is taken, no order is created and nothing you type is stored or sent.</div>
      <ol className="steps" aria-label="Checkout steps">
        {["Details", "Delivery", "Payment"].map((s, i) => (
          <li key={s} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>
            <button type="button" disabled={step <= i + 1} onClick={() => setStep((i + 1) as Step)}><span>{step > i + 1 ? <I.check width={14} /> : i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>

      <div className="co-grid">
        <form className="co-main" onSubmit={next} noValidate>
          {step === 1 && (
            <section aria-labelledby="h-details">
              <div className="co-head">
                <h1 id="h-details" className="h3">Delivery details</h1>
                <button type="button" className="text-btn" onClick={() => { setD(SAMPLE); setErrors({}); }}>Fill with sample details</button>
              </div>
              <div className="form-grid">
                <label className="field span2"><span>Full name</span><input autoComplete="off" {...field("name")} /><Err k="name" /></label>
                <label className="field"><span>Mobile number</span><input inputMode="tel" autoComplete="off" placeholder="01X XXXX XXXX" {...field("phone")} /><Err k="phone" /></label>
                <label className="field"><span>Email <small>(optional)</small></span><input type="email" autoComplete="off" {...field("email")} /><Err k="email" /></label>
                <label className="field"><span>Governorate</span>
                  <select {...field("governorate")}><option value="">Choose…</option>{GOVERNORATES.map((g) => <option key={g}>{g}</option>)}</select><Err k="governorate" />
                </label>
                <label className="field"><span>City / area</span><input autoComplete="off" {...field("city")} /><Err k="city" /></label>
                <label className="field span2"><span>Street, building, apartment</span><input autoComplete="off" {...field("address")} /><Err k="address" /></label>
                <label className="field span2"><span>Delivery notes <small>(optional)</small></span><textarea rows={2} {...field("notes")} /></label>
              </div>
              <p className="muted small">Demo: please use sample details. They are kept on this page only and discarded.</p>
              <button type="submit" className="btn btn-dark btn-wide">Continue to delivery <I.arrow width={16} /></button>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="h-delivery">
              <h1 id="h-delivery" className="h3">Delivery</h1>
              <div className="summary-box">
                <div><span className="muted small">Deliver to</span><p>{d.name} · {d.phone}<br />{d.address}, {d.city}, {d.governorate}</p></div>
                <button type="button" className="text-btn" onClick={() => setStep(1)}>Edit</button>
              </div>
              <label className="option on">
                <input type="radio" name="ship" defaultChecked />
                <span className="opt-body">
                  <strong>Standard nationwide delivery</strong>
                  <small>Estimated 3–7 days · all 27 governorates</small>
                </span>
                <span className="opt-price">{delivery === 0 ? "Free" : egp(delivery)}</span>
              </label>
              {delivery > 0 && <p className="muted small">Free delivery on orders over {egp(FREE_DELIVERY_OVER)}.</p>}
              <button type="submit" className="btn btn-dark btn-wide">Continue to payment <I.arrow width={16} /></button>
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="h-pay">
              <h1 id="h-pay" className="h3">Payment</h1>
              <div className="pay-methods" role="radiogroup" aria-label="Payment method">
                <label className={`option ${method === "card" ? "on" : ""}`}>
                  <input type="radio" name="pay" checked={method === "card"} onChange={() => setMethod("card")} />
                  <I.card /><span className="opt-body"><strong>Bank card</strong><small>Visa · Mastercard · Meeza — via Paymob</small></span>
                </label>
                <label className={`option ${method === "wallet" ? "on" : ""}`}>
                  <input type="radio" name="pay" checked={method === "wallet"} onChange={() => setMethod("wallet")} />
                  <I.phone /><span className="opt-body"><strong>Mobile wallet</strong><small>Vodafone Cash, Orange, Etisalat, WE — via Paymob</small></span>
                </label>
              </div>

              <div className="paymob" aria-label="Paymob payment (simulated)">
                <div className="pm-head"><span className="pm-logo">paymob</span><span className="pm-demo">DEMO · SIMULATED</span></div>
                {method === "card" ? (
                  <div className="pm-body">
                    <div className="pm-field"><span>Card number</span><output>4987 •••• •••• 8769</output></div>
                    <div className="pm-row">
                      <div className="pm-field"><span>Expiry</span><output>12 / 29</output></div>
                      <div className="pm-field"><span>CVV</span><output>•••</output></div>
                    </div>
                    <div className="pm-field"><span>Name on card</span><output>DEMO CARD</output></div>
                    <p className="pm-note">Fixed sample card — this demo has no fields for real card details.</p>
                  </div>
                ) : (
                  <div className="pm-body">
                    <div className="pm-field"><span>Wallet number</span><output>010 •••• 0000</output></div>
                    <p className="pm-note">Sample wallet — in the live store Paymob would send a payment request to the customer's phone.</p>
                  </div>
                )}
              </div>

              <button type="button" className="btn btn-gold btn-wide" onClick={pay} disabled={phase !== "idle"}>
                <I.lock width={16} /> Pay {egp(total)} <small>(simulated)</small>
              </button>
              <p className="muted small">By paying you agree to the <Link to="/policies">store policies</Link>. Demo: no money moves.</p>
            </section>
          )}
        </form>

        <aside className="co-side" aria-label="Order summary">
          <h2 className="h4">Order summary</h2>
          <ul className="co-lines">
            {cart.map((l) => {
              const p = findProduct(l.slug)!;
              return (
                <li key={`${l.slug}-${l.size}`}>
                  <span className="co-img"><ProductVisual p={p} /><b>{l.qty}</b></span>
                  <span className="co-info"><strong>{p.name}</strong><small>{p.piece} · {l.size}</small></span>
                  <span>{egp(p.price * l.qty)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="co-totals">
            <div><dt>Subtotal</dt><dd>{egp(subtotal)}</dd></div>
            <div><dt>Delivery</dt><dd>{delivery === 0 ? "Free" : egp(delivery)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{egp(total)}</dd></div>
          </dl>
          <button type="button" className="text-btn" onClick={() => navigate("/shop")}>← Continue shopping</button>
        </aside>
      </div>

      {(phase === "processing" || phase === "otp") && (
        <div className="overlay pm-overlay" role="dialog" aria-modal="true" aria-label="Payment in progress">
          <div className="pm-modal">
            <div className="pm-head"><span className="pm-logo">paymob</span><span className="pm-demo">DEMO</span></div>
            {phase === "processing" ? (
              <div className="pm-wait"><span className="spinner" aria-hidden /><p>{method === "card" ? "Contacting the bank…" : "Waiting for wallet approval…"}</p><small>Simulation — nothing is being charged.</small></div>
            ) : (
              <form className="pm-otp" onSubmit={(e) => { e.preventDefault(); finish(); }}>
                <p>3-D Secure check (simulated)</p>
                <label htmlFor="otp">Enter any 4–6 digits</label>
                <input id="otp" inputMode="numeric" autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" />
                <button type="submit" className="btn btn-dark btn-block" disabled={otp.length < 4}>Confirm</button>
                <button type="button" className="text-btn" onClick={() => { setPhase("idle"); setOtp(""); }}>Cancel payment</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Confirmation({ order, name }: { order: DemoOrder; name: string }) {
  const eta = (days: number) => new Date(Date.now() + days * 864e5).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="page wrap narrow confirm">
      <div className="confirm-seal" aria-hidden><I.check width={34} /></div>
      <span className="kicker gold">Mission complete</span>
      <h1 className="h1">The look is yours{name ? `, ${name.split(" ")[0]}` : ""}.</h1>
      <p className="lead">Order <strong>{order.ref}</strong> · {order.items} {order.items === 1 ? "piece" : "pieces"} · {egp(order.total)}</p>
      <div className="confirm-box">
        <div><span className="muted small">Payment</span><p>{order.method}</p></div>
        <div><span className="muted small">Estimated delivery</span><p>{eta(3)} – {eta(7)}</p></div>
      </div>
      <p className="demo-callout"><strong>Demo mode:</strong> this is a simulated confirmation. No real order was placed, no payment was taken, and no details were stored. Stock in the demo was reduced so you can see inventory change — use “Reset demo” to restore it.</p>
      <div className="confirm-cta">
        <Link to="/shop" className="btn btn-dark">Continue shopping</Link>
        <Link to="/heist" className="btn btn-ghost">Explore The Heist</Link>
      </div>
    </div>
  );
}
