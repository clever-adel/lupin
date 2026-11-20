import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DELIVERY_FEE, FREE_DELIVERY_OVER, egp } from "../data";
import { I } from "../components/ui";
import { useStore } from "../store";

export default function Policies() {
  const { hash } = useLocation();
  const { orders } = useStore();
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [hash]);

  const sections = [
    {
      id: "delivery", icon: <I.truck />, title: "Nationwide delivery",
      body: (
        <>
          <p>We deliver to all 27 governorates of Egypt. Estimated delivery is <strong>3–7 days</strong> from order confirmation.</p>
          <ul>
            <li>Delivery fee: {egp(DELIVERY_FEE)} per order.</li>
            <li>Free delivery on orders over {egp(FREE_DELIVERY_OVER)}.</li>
            <li>You receive a tracking update when your order leaves us.</li>
          </ul>
        </>
      ),
    },
    {
      id: "returns", icon: <I.shield />, title: "Returns & exchanges",
      body: (
        <>
          <p>Returns, exchanges and refunds follow the applicable Egyptian consumer protection laws, including the Consumer Protection Law No. 181 of 2018 and its executive regulations.</p>
          <ul>
            <li>Items must be unworn and unwashed, with original tags and packaging.</li>
            <li>Faulty or wrong items are replaced or refunded at no cost to you.</li>
            <li>Contact customer care with your order number to start a return.</li>
          </ul>
          <p className="muted small">Demo note: this text summarises the intended policy for presentation and is not legal advice.</p>
        </>
      ),
    },
    {
      id: "payment", icon: <I.card />, title: "Secure payment by Paymob",
      body: (
        <>
          <p>Online payments are processed by Paymob — bank cards (Visa, Mastercard, Meeza) and mobile wallets. Card details are entered on Paymob's secure page and never reach our servers.</p>
          <p><strong>In this demo the Paymob step is a simulation:</strong> it shows fixed sample values, has no fields for real card details and takes no money.</p>
        </>
      ),
    },
    {
      id: "demo", icon: <I.key />, title: "About this demo",
      body: (
        <>
          <ul>
            <li><strong>No real payments.</strong> Checkout is simulated end to end.</li>
            <li><strong>No real orders.</strong> Confirmation numbers start with LW-DEMO and exist only in this browser.</li>
            <li><strong>No customer data collection.</strong> Checkout details stay on the page and are discarded; newsletter forms store nothing.</li>
            <li><strong>Sample products and inventory.</strong> Pieces marked “Real piece” use actual product photos of items in the LUPIN. store; pieces marked “Demo item” are illustrated samples, not photographs of products.</li>
            <li><strong>Fictional campaign.</strong> All heist scenarios are staged advertising.</li>
            <li>Cart, wishlist and demo stock are kept in this browser only. Use <em>Reset demo</em> in the top bar to restore the starting state.</li>
          </ul>
          {orders.length > 0 && (
            <div className="demo-orders">
              <span className="kicker">Simulated orders in this browser</span>
              <ul>{orders.map((o) => <li key={o.ref}><strong>{o.ref}</strong> · {o.items} pcs · {egp(o.total)} · {new Date(o.at).toLocaleString("en-GB")}</li>)}</ul>
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="page">
      <section className="page-hero dark">
        <div className="wrap">
          <span className="kicker gold">Customer care</span>
          <h1 className="h1 light">Service & <em>policies</em></h1>
          <p className="lead light">Delivery, returns, payment — and what this demo does and doesn't do.</p>
          <nav className="pill-nav" aria-label="Policy sections">
            {sections.map((s) => <a key={s.id} href={`#/policies#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }); }}>{s.title}</a>)}
          </nav>
        </div>
      </section>
      <div className="wrap narrow policies">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="policy">
            <div className="policy-icon">{s.icon}</div>
            <div><h2 className="h3">{s.title}</h2>{s.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
