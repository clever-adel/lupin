// Demo catalogue for LUPIN WEAR.
//
// Two kinds of product live here, and the store always tells them apart:
//  - "real": pieces actually listed on lupinwear.store, shown with the owner's actual product photos
//    (copied from the live store; AI-generated model shots were deliberately left out).
//  - "demo": sample pieces that exist only to fill the demo. They have NO photo: they are drawn as
//    clearly labelled illustrations and carry a "Demo item" tag everywhere they appear.

export type Category = "hoodies" | "outerwear" | "tees" | "pants" | "accessories";
export type Kind = "real" | "demo";
export type Shape = "tee" | "cargo" | "cap" | "bag" | "beanie" | "overshirt" | "coat";

export interface Product {
  id: string;
  slug: string;
  name: string; // operation name
  piece: string; // what it is
  maker: string;
  kind: Kind;
  category: Category;
  price: number;
  compareAt?: number;
  sizes: string[];
  stock: Record<string, number>; // initial stock per size
  colour: string;
  description: string;
  details: string[];
  images: string[]; // real photos only
  illustration?: { shape: Shape; fill: string; accent: string };
  mission?: 1 | 2 | 3;
  bestSeller?: boolean;
  added: string; // ISO date, drives "New arrivals"
  sold: number; // drives "Best selling" sort
}

const p = (file: string) => `./products/${file}.webp`;

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: "hoodies", label: "Hoodies", blurb: "Heavy fleece, quiet confidence." },
  { id: "outerwear", label: "Outerwear", blurb: "Layers for the getaway." },
  { id: "tees", label: "Tees", blurb: "The everyday alibi." },
  { id: "pants", label: "Pants", blurb: "Built to move." },
  { id: "accessories", label: "Accessories", blurb: "The final detail." },
];

export const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "One size"];

export const PRODUCTS: Product[] = [
  {
    id: "p-alibi",
    slug: "the-alibi",
    name: "The Alibi",
    piece: "Oversized hoodie — brown",
    maker: "Bershka",
    kind: "real",
    category: "hoodies",
    price: 690,
    compareAt: 900,
    sizes: ["XS", "S", "M", "L", "XL"],
    stock: { XS: 0, S: 3, M: 5, L: 2, XL: 0 },
    colour: "Brown",
    description:
      "Everyone saw you. No one can prove it. An oversized brown hoodie by Bershka with a soft brushed fleece inside, a kangaroo pocket and an embroidered chest logo.",
    details: ["Oversized fit — take your usual size", "Brushed fleece inside", "Kangaroo pocket", "Embroidered chest logo, printed back graphic", "Original Bershka piece, legally sourced"],
    images: [p("alibi-1"), p("alibi-3"), p("alibi-2"), p("alibi-5"), p("alibi-4"), p("alibi-6")],
    mission: 1,
    bestSeller: true,
    added: "2026-11-01",
    sold: 48,
  },
  {
    id: "p-master-key",
    slug: "the-master-key",
    name: "The Master Key",
    piece: "Graphic hoodie — stone",
    maker: "Bershka",
    kind: "real",
    category: "hoodies",
    price: 690,
    compareAt: 900,
    sizes: ["XS", "S", "M", "L", "XL"],
    stock: { XS: 2, S: 4, M: 6, L: 3, XL: 0 },
    colour: "Stone",
    description:
      "Every door opens for the right key. A stone hoodie with a blue Room Service — Presidential Suite print: the hotel key and emblem across the back, the script name on the chest.",
    details: ["Relaxed fit", "Large back print, small chest print", "Brushed fleece inside", "Original Bershka piece, legally sourced"],
    images: [p("masterkey-1"), p("masterkey-2"), p("masterkey-3")],
    mission: 1,
    bestSeller: true,
    added: "2026-11-03",
    sold: 41,
  },
  {
    id: "p-brooklyn",
    slug: "the-brooklyn-job",
    name: "The Brooklyn Job",
    piece: "Graffiti hoodie — cream",
    maker: "Bershka",
    kind: "real",
    category: "hoodies",
    price: 690,
    compareAt: 900,
    sizes: ["XS", "S", "M", "L", "XL"],
    stock: { XS: 1, S: 2, M: 4, L: 2, XL: 0 },
    colour: "Cream",
    description:
      "In and out before the paint dries. A cream hoodie by Bershka with a black spray-paint BROOKLYN graffiti print across the chest and a soft brushed fleece inside.",
    details: ["Boxy fit", "Spray-paint graffiti print", "Brushed fleece inside", "Original Bershka piece, legally sourced"],
    images: [p("brooklyn-1"), p("brooklyn-3"), p("brooklyn-2"), p("brooklyn-4"), p("brooklyn-5")],
    mission: 1,
    bestSeller: true,
    added: "2026-11-05",
    sold: 37,
  },
  {
    id: "p-getaway",
    slug: "the-getaway-driver",
    name: "The Getaway Driver",
    piece: "Sherpa denim jacket — black",
    maker: "LC Waikiki",
    kind: "real",
    category: "outerwear",
    price: 1440,
    compareAt: 1800,
    sizes: ["S", "M", "L", "XL"],
    stock: { S: 0, M: 2, L: 3, XL: 0 },
    colour: "Black",
    description:
      "Engine running, collar up. A black denim trucker jacket by LC Waikiki with a warm sherpa collar and lining. Two button-flap chest pockets, side pockets and metal press buttons.",
    details: ["Regular fit", "Sherpa collar and lining", "Button-flap chest pockets", "Original LC Waikiki piece, legally sourced"],
    images: [p("getaway-1"), p("getaway-2")],
    mission: 2,
    bestSeller: true,
    added: "2026-11-08",
    sold: 22,
  },
  {
    id: "p-stealth",
    slug: "the-stealth",
    name: "The Stealth",
    piece: "Soft shell jacket — black",
    maker: "Team 365",
    kind: "real",
    category: "outerwear",
    price: 790,
    compareAt: 990,
    sizes: ["S", "M", "L", "XL"],
    stock: { S: 0, M: 3, L: 0, XL: 0 },
    colour: "Black · Sport silver",
    description:
      "Move unseen, stay dry. A sleek soft shell jacket by Team 365 that keeps out wind and light rain while letting your body breathe. Stand-up collar with chin guard.",
    details: ["Wind- and water-resistant soft shell", "Breathable", "Stand-up collar with chin guard", "Zip pockets", "Original Team 365 piece, legally sourced"],
    images: [p("stealth-1"), p("stealth-2"), p("stealth-5")],
    mission: 2,
    added: "2026-11-10",
    sold: 15,
  },
  {
    id: "p-inside-man",
    slug: "the-inside-man",
    name: "The Inside Man",
    piece: "Loose fit sweatshirt — dark brown",
    maker: "H&M",
    kind: "real",
    category: "hoodies",
    price: 690,
    compareAt: 900,
    sizes: ["XS", "S", "M", "L", "XL"],
    stock: { XS: 2, S: 4, M: 5, L: 3, XL: 1 },
    colour: "Dark brown",
    description:
      "Already on the inside before anyone noticed. A loose fit sweatshirt by H&M in a soft French terry with a brushed inside — round rib-trimmed neckline, dropped shoulders, long sleeves and ribbing at the cuffs and hem.",
    details: [
      "Loose fit — take your usual size",
      "French terry, soft brushed inside",
      "60% cotton, 40% polyester (min. 10% recycled polyester)",
      "Rib-trimmed neckline, cuffs and hem",
      "Dropped shoulders",
      "Original H&M piece, legally sourced",
    ],
    images: [p("insideman-1"), p("insideman-2")],
    mission: 1,
    added: "2026-11-27",
    sold: 0,
  },
  // ----- Demo items: no photographs, illustrated and labelled -----
  {
    id: "d-vault-tee",
    slug: "the-vault-tee",
    name: "The Vault",
    piece: "Heavyweight tee — onyx",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "tees",
    price: 650,
    sizes: ["S", "M", "L", "XL", "XXL"],
    stock: { S: 8, M: 12, L: 10, XL: 6, XXL: 3 },
    colour: "Onyx",
    description: "A sample piece for the demo. A dense 260 gsm cotton tee with a boxy drop shoulder and a tonal LUPIN. mark on the chest.",
    details: ["Demo item — sample product", "260 gsm cotton (sample spec)", "Boxy, drop shoulder", "Tonal chest mark"],
    images: [],
    illustration: { shape: "tee", fill: "#1b1b1d", accent: "#3a3a3e" },
    mission: 2,
    bestSeller: true,
    added: "2026-11-15",
    sold: 33,
  },
  {
    id: "d-night-shift",
    slug: "the-night-shift",
    name: "The Night Shift",
    piece: "Utility cargo pant — charcoal",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "pants",
    price: 1250,
    compareAt: 1450,
    sizes: ["S", "M", "L", "XL"],
    stock: { S: 4, M: 6, L: 5, XL: 2 },
    colour: "Charcoal",
    description: "A sample piece for the demo. A relaxed cargo pant in brushed twill with bellows pockets and adjustable hems.",
    details: ["Demo item — sample product", "Brushed cotton twill (sample spec)", "Bellows cargo pockets", "Drawcord hems"],
    images: [],
    illustration: { shape: "cargo", fill: "#2a2a2c", accent: "#4a4a4f" },
    mission: 2,
    added: "2026-11-16",
    sold: 19,
  },
  {
    id: "d-fence",
    slug: "the-fence",
    name: "The Fence",
    piece: "Wool-blend overshirt — camel",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "outerwear",
    price: 1350,
    sizes: ["S", "M", "L", "XL"],
    stock: { S: 2, M: 4, L: 4, XL: 1 },
    colour: "Camel",
    description: "A sample piece for the demo. A wool-blend overshirt with horn-effect buttons — worn open as a layer or closed as a shirt.",
    details: ["Demo item — sample product", "Wool-blend (sample spec)", "Two chest pockets", "Horn-effect buttons"],
    images: [],
    illustration: { shape: "overshirt", fill: "#a8875a", accent: "#7d6240" },
    mission: 2,
    added: "2026-11-17",
    sold: 11,
  },
  {
    id: "d-gentleman",
    slug: "the-gentleman",
    name: "The Gentleman",
    piece: "Tailored overcoat — black",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "outerwear",
    price: 2950,
    sizes: ["M", "L", "XL"],
    stock: { M: 1, L: 2, XL: 1 },
    colour: "Black",
    description: "A sample piece for the demo. A long, clean overcoat cut for layering over a hoodie — the thief's signature silhouette.",
    details: ["Demo item — sample product", "Wool-blend melton (sample spec)", "Notch lapel", "Inner gold-tone LUPIN. tab"],
    images: [],
    illustration: { shape: "coat", fill: "#121214", accent: "#2c2c30" },
    mission: 3,
    added: "2026-11-18",
    sold: 6,
  },
  {
    id: "d-cipher",
    slug: "the-cipher",
    name: "The Cipher",
    piece: "Six-panel cap — black",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "accessories",
    price: 450,
    sizes: ["One size"],
    stock: { "One size": 14 },
    colour: "Black",
    description: "A sample piece for the demo. A washed cotton six-panel cap with a curved peak and a small embroidered mark.",
    details: ["Demo item — sample product", "Washed cotton (sample spec)", "Adjustable strap"],
    images: [],
    illustration: { shape: "cap", fill: "#18181a", accent: "#b08d57" },
    added: "2026-11-12",
    sold: 27,
  },
  {
    id: "d-ledger",
    slug: "the-ledger",
    name: "The Ledger",
    piece: "Crossbody bag — black",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "accessories",
    price: 890,
    sizes: ["One size"],
    stock: { "One size": 5 },
    colour: "Black",
    description: "A sample piece for the demo. A compact crossbody with a hidden back pocket — everything you need for a quick exit.",
    details: ["Demo item — sample product", "Coated nylon (sample spec)", "Hidden back pocket", "Gold-tone hardware"],
    images: [],
    illustration: { shape: "bag", fill: "#161618", accent: "#b08d57" },
    added: "2026-11-14",
    sold: 9,
  },
  {
    id: "d-monocle",
    slug: "the-monocle",
    name: "The Monocle",
    piece: "Ribbed beanie — bone",
    maker: "LUPIN. (demo concept)",
    kind: "demo",
    category: "accessories",
    price: 390,
    compareAt: 490,
    sizes: ["One size"],
    stock: { "One size": 0 },
    colour: "Bone",
    description: "A sample piece for the demo. A soft rib-knit beanie with a deep cuff. Shown sold out so the demo includes an out-of-stock product.",
    details: ["Demo item — sample product", "Rib knit (sample spec)", "Deep cuff"],
    images: [],
    illustration: { shape: "beanie", fill: "#e6e1d6", accent: "#c9c1b0" },
    added: "2026-11-06",
    sold: 30,
  },
];

export const MISSIONS = [
  {
    n: 1 as const,
    code: "001",
    title: "The First Drop",
    status: "Live now",
    lede: "Three original hoodies. One mission. The drop that put LUPIN. on the map.",
    body: "The blueprint was spread across the desk at midnight. Three targets, each with an operation name: The Alibi, The Master Key, The Brooklyn Job. The plan was simple — make the look impossible to ignore.",
    image: "./campaign/m001-lineup.webp",
  },
  {
    n: 2 as const,
    code: "002",
    title: "The Collection",
    status: "In progress",
    lede: "The crew expands. Outerwear, essentials and the pieces that complete the look.",
    body: "One heist is a story. A collection is a legend. Jackets for the getaway, essentials for the alibi — every piece with its own codename.",
    image: "./campaign/m001-the-master-key.webp",
  },
  {
    n: 3 as const,
    code: "003",
    title: "The Next Heist",
    status: "Classified",
    lede: "The plan is drawn. The date is sealed. Only the crew will know first.",
    body: "Details remain classified. Join the list to receive the coordinates before anyone else.",
    image: "./campaign/m001-teaser.webp",
  },
];

export const GOVERNORATES = [
  "Cairo", "Giza", "Alexandria", "Qalyubia", "Sharqia", "Dakahlia", "Gharbia", "Monufia", "Beheira", "Kafr El Sheikh",
  "Damietta", "Port Said", "Ismailia", "Suez", "Faiyum", "Beni Suef", "Minya", "Asyut", "Sohag", "Qena", "Luxor",
  "Aswan", "Red Sea", "New Valley", "Matrouh", "North Sinai", "South Sinai",
];

export const FREE_DELIVERY_OVER = 2000;
export const DELIVERY_FEE = 75;

export const egp = (n: number) => `EGP ${n.toLocaleString("en-US")}`;
export const discountPct = (pr: Product) => (pr.compareAt ? Math.round((1 - pr.price / pr.compareAt) * 100) : 0);
export const findProduct = (slug: string) => PRODUCTS.find((x) => x.slug === slug);
export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)?.label ?? c;
