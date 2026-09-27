/**
 * Reference data used by the seed script and tests. Orbital elements and physical parameters are
 * APPROXIMATE (rounded, epoch unspecified) — refresh each NEA from JPL SBDB before relying on it.
 */
import type { OrbitalNode, SourceType } from "@/lib/models";

export interface ItemDef {
  code: string;
  name: string;
  kind: "material" | "product";
  unit: "kg" | "unit";
  unitMassKg: number;
  description: string;
  isPublic: boolean;
}

export const MATERIAL_ITEMS: ItemDef[] = [
  {
    code: "O2",
    name: "Oxygen (O₂)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: true,
    description:
      "Gaseous or liquefied oxygen from regolith electrolysis or ilmenite reduction. Propellant oxidiser and life support.",
  },
  {
    code: "SI",
    name: "Silicon (Si)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: true,
    description:
      "Si-equivalent mass. MRE produces an Fe–Si–Ti alloy; separation/refining to metallurgical grade is a downstream step.",
  },
  {
    code: "TI",
    name: "Titanium (Ti)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: true,
    description:
      "Ti-equivalent mass (alloy or TiO₂-rich residue depending on process); tracked as feedstock for Ti fabrication.",
  },
  {
    code: "FE",
    name: "Iron (Fe)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: true,
    description: "Metallic iron / Fe–Ni concentrate for structural fabrication.",
  },
  {
    code: "AL",
    name: "Aluminium (Al)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: false,
    description: "Tracked for completeness; no current process recovers Al (it stays in MRE slag).",
  },
  {
    code: "MG",
    name: "Magnesium (Mg)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: false,
    description: "Tracked for completeness; no current process recovers Mg.",
  },
  {
    code: "H2O",
    name: "Water (H₂O)",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: true,
    description: "Water released from hydrated minerals in C-type asteroids.",
  },
  {
    code: "REGOLITH",
    name: "Sieved regolith feedstock",
    kind: "material",
    unit: "kg",
    unitMassKg: 1,
    isPublic: false,
    description: "Excavated, sieved (<1 mm) regolith used for sintering.",
  },
];

export interface ProductDef extends ItemDef {
  bom: { itemCode: string; kgPerUnit: number }[];
  energyKWhPerUnit: number;
  opsCostPerUnitCents: number;
  leadTimeDays: number;
  depotCode: string;
}

export const PRODUCT_ITEMS: ProductDef[] = [
  {
    code: "SI-FEED-25",
    name: "Solar-grade silicon feedstock ingot (25 kg)",
    kind: "product",
    unit: "unit",
    unitMassKg: 25,
    isPublic: true,
    description:
      "Directionally solidified Si feedstock for in-orbit solar cell production. Purity specification to be agreed per contract.",
    bom: [{ itemCode: "SI", kgPerUnit: 27.5 }],
    energyKWhPerUnit: 60,
    opsCostPerUnitCents: 250_000,
    leadTimeDays: 14,
    depotCode: "LEO-FAB",
  },
  {
    code: "TI-TRUSS-2M",
    name: "Titanium truss segment, 2 m",
    kind: "product",
    unit: "unit",
    unitMassKg: 14,
    isPublic: true,
    description:
      "Additively manufactured Ti truss bay with standard end fittings for in-space assembly.",
    bom: [{ itemCode: "TI", kgPerUnit: 15.5 }],
    energyKWhPerUnit: 45,
    opsCostPerUnitCents: 150_000,
    leadTimeDays: 10,
    depotCode: "EML1-GW",
  },
  {
    code: "FE-BEAM-3M",
    name: "Iron structural beam, 3 m",
    kind: "product",
    unit: "unit",
    unitMassKg: 45,
    isPublic: true,
    description: "Rolled Fe I-beam for surface habitats, landing pads and berms.",
    bom: [{ itemCode: "FE", kgPerUnit: 48 }],
    energyKWhPerUnit: 30,
    opsCostPerUnitCents: 80_000,
    leadTimeDays: 7,
    depotCode: "LSP",
  },
  {
    code: "SHIELD-TILE",
    name: "Sintered regolith radiation-shielding tile",
    kind: "product",
    unit: "unit",
    unitMassKg: 50,
    isPublic: true,
    description:
      "0.5 × 0.5 × 0.1 m microwave-sintered regolith tile for habitat shielding and blast walls.",
    bom: [{ itemCode: "REGOLITH", kgPerUnit: 52 }],
    energyKWhPerUnit: 35,
    opsCostPerUnitCents: 20_000,
    leadTimeDays: 5,
    depotCode: "LSP",
  },
  {
    code: "LOX-100",
    name: "Liquid oxygen propellant (100 kg)",
    kind: "product",
    unit: "unit",
    unitMassKg: 100,
    isPublic: true,
    description: "Liquefied O₂ delivered into customer tankage; ~1% liquefaction loss included.",
    bom: [{ itemCode: "O2", kgPerUnit: 101 }],
    energyKWhPerUnit: 40,
    opsCostPerUnitCents: 10_000,
    leadTimeDays: 3,
    depotCode: "EML1-GW",
  },
];

export interface DepotDef {
  code: string;
  name: string;
  node: OrbitalNode;
  description: string;
}

export const DEPOTS: DepotDef[] = [
  {
    code: "LSP",
    name: "Lunar South Pole Depot",
    node: "LUNAR_SURFACE",
    description: "Surface depot on the Shackleton crater rim (≈89.9°S).",
  },
  {
    code: "TRQ",
    name: "Tranquillitatis Field Depot",
    node: "LUNAR_SURFACE",
    description: "Surface depot serving the high-Ti mare extraction field.",
  },
  {
    code: "EML1-GW",
    name: "EML1 Gateway Depot",
    node: "EML1",
    description: "Propellant and materials depot at Earth–Moon L1.",
  },
  {
    code: "LEO-FAB",
    name: "LEO Fabrication Station",
    node: "LEO",
    description: "Fabrication and hand-over station in a 400 km orbit.",
  },
];

export interface TargetDef {
  slug: string;
  name: string;
  kind: "lunar_site" | "nea";
  sourceType: SourceType;
  designation?: string;
  spectralClass?: string | null;
  latitudeDeg?: number;
  longitudeDeg?: number;
  aAu?: number;
  e?: number;
  iDeg?: number;
  hMag?: number;
  diameterKm?: number;
  description: string;
}

const APPROX = "Approximate — refresh from JPL SBDB before use.";

export const TARGETS: TargetDef[] = [
  {
    slug: "mare-tranquillitatis",
    name: "Mare Tranquillitatis (high-Ti mare)",
    kind: "lunar_site",
    sourceType: "lunar_mare_high_ti",
    latitudeDeg: 0.7,
    longitudeDeg: 23.5,
    description:
      "High-Ti basaltic mare near the Apollo 11 site. Best lunar ilmenite and Ti feedstock.",
  },
  {
    slug: "oceanus-procellarum",
    name: "Oceanus Procellarum (low-Ti mare)",
    kind: "lunar_site",
    sourceType: "lunar_mare_low_ti",
    latitudeDeg: -3.0,
    longitudeDeg: -23.4,
    description: "Low-Ti mare basalt near the Apollo 12 site.",
  },
  {
    slug: "descartes-highlands",
    name: "Descartes highlands",
    kind: "lunar_site",
    sourceType: "lunar_highland",
    latitudeDeg: -9.0,
    longitudeDeg: 15.5,
    description: "Feldspathic highland regolith near the Apollo 16 site; Al-rich, Ti-poor.",
  },
  {
    slug: "shackleton-rim",
    name: "Shackleton crater rim (south polar)",
    kind: "lunar_site",
    sourceType: "lunar_highland",
    latitudeDeg: -89.9,
    longitudeDeg: 0,
    description:
      "Near-continuously illuminated rim; highland composition assumed. Nearby permanently shadowed ice is excluded from the model pending survey data.",
  },
  {
    slug: "ryugu",
    name: "162173 Ryugu",
    kind: "nea",
    sourceType: "nea_c",
    designation: "162173",
    spectralClass: "Cg",
    aAu: 1.19,
    e: 0.19,
    iDeg: 5.88,
    hMag: 19.3,
    diameterKm: 0.9,
    description: `Hayabusa2 sample-return target. ${APPROX}`,
  },
  {
    slug: "bennu",
    name: "101955 Bennu",
    kind: "nea",
    sourceType: "nea_c",
    designation: "101955",
    spectralClass: "B",
    aAu: 1.126,
    e: 0.204,
    iDeg: 6.03,
    hMag: 20.2,
    diameterKm: 0.49,
    description: `OSIRIS-REx sample-return target. ${APPROX}`,
  },
  {
    slug: "itokawa",
    name: "25143 Itokawa",
    kind: "nea",
    sourceType: "nea_s",
    designation: "25143",
    spectralClass: "S",
    aAu: 1.324,
    e: 0.28,
    iDeg: 1.62,
    hMag: 19.2,
    diameterKm: 0.33,
    description: `Hayabusa sample-return target (LL-chondrite-like). ${APPROX}`,
  },
  {
    slug: "nereus",
    name: "4660 Nereus",
    kind: "nea",
    sourceType: "nea_s",
    designation: "4660",
    spectralClass: "Xe",
    aAu: 1.489,
    e: 0.36,
    iDeg: 1.43,
    hMag: 18.3,
    diameterKm: 0.33,
    description: `Low-Δv X/E-class target; S-type proxy (low confidence). ${APPROX}`,
  },
  {
    slug: "didymos",
    name: "65803 Didymos",
    kind: "nea",
    sourceType: "nea_s",
    designation: "65803",
    spectralClass: "S",
    aAu: 1.643,
    e: 0.384,
    iDeg: 3.41,
    hMag: 18.1,
    diameterKm: 0.78,
    description: `Binary system visited by DART / Hera. ${APPROX}`,
  },
  {
    slug: "1989-ml",
    name: "10302 (1989 ML)",
    kind: "nea",
    sourceType: "nea_m",
    designation: "10302",
    spectralClass: "X",
    aAu: 1.272,
    e: 0.137,
    iDeg: 4.38,
    hMag: 19.4,
    diameterKm: 0.25,
    description: `X-class; metal-rich proxy (low confidence). ${APPROX}`,
  },
  {
    slug: "1996-fg3",
    name: "175706 (1996 FG3)",
    kind: "nea",
    sourceType: "nea_c",
    designation: "175706",
    spectralClass: "C",
    aAu: 1.054,
    e: 0.35,
    iDeg: 1.99,
    hMag: 17.8,
    diameterKm: 1.7,
    description: `Binary C-type NEA. ${APPROX}`,
  },
  {
    slug: "2000-sg344",
    name: "2000 SG344",
    kind: "nea",
    sourceType: "nea_s",
    designation: "2000 SG344",
    spectralClass: null,
    aAu: 0.977,
    e: 0.067,
    iDeg: 0.11,
    hMag: 24.8,
    diameterKm: 0.04,
    description: `Very Earth-like orbit, tens of metres across; spectral type unknown — S-type placeholder. ${APPROX}`,
  },
];
