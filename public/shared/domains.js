// Riftbound domain icons (official, from the League of Legends wiki's RB icons)
// and colours. Each icon is a coloured disc with the white domain symbol.

export const DOMAINS = ["fury", "calm", "mind", "body", "chaos", "order"];

// The discs' own fills, so bars and icons match.
export const DOMAIN_COLORS = {
  fury: "#df1620",
  calm: "#488c38",
  mind: "#0f6fa6",
  body: "#e87600",
  chaos: "#6a4094",
  order: "#d2b400",
};

const title = (d) => d.charAt(0).toUpperCase() + d.slice(1);

/** <img> of a domain icon; unknown domains get a neutral disc. */
export function domainIcon(domain, cls = "") {
  const d = String(domain || "").toLowerCase();
  if (!DOMAINS.includes(d)) return `<i class="dom-ic dom-unknown ${cls}" title="${title(d || "rune")}"></i>`;
  return `<img class="dom-ic ${cls}" src="/shared/domains/${d}.svg" alt="${title(d)}" title="${title(d)}" draggable="false" />`;
}
