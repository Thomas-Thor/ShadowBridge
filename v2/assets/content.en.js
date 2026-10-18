// Public, non-secret content only. Add a separate locale module and translated
// HTML entry point for each future language; keep SEO copy in the HTML.
export const publicContact = Object.freeze({
  // Confirmed by the owner; this is a public contact address, not a credential.
  email: "shadowbridge.trade@gmail.com",
  legalName: null,
  phone: null,
});

export const industries = Object.freeze({
  food: {
    title: "Food & agriculture",
    kicker: "ESSENTIAL PRODUCTS. RELEVANT CONNECTIONS.",
    description:
      "Connecting product requirements with potential producers, processors and wholesale counterparties. Specifications, volumes, origin and delivery expectations shape the conversation.",
  },
  water: {
    title: "Water & beverages",
    kicker: "CLEAR REQUIREMENTS. FOCUSED SOURCING.",
    description:
      "Explore bottled water and beverage sourcing or distribution opportunities. Product format, certifications, volumes and destination requirements help define a relevant commercial brief.",
  },
  machinery: {
    title: "Machinery & equipment",
    kicker: "THE RIGHT CAPABILITY FOR THE TASK.",
    description:
      "Introduce your equipment needs or available machinery. Technical specifications, condition, documentation and delivery expectations provide the basis for identifying potential counterparties.",
  },
  industrial: {
    title: "Industrial supplies",
    kicker: "SUPPORTING THE BUSINESSES THAT BUILD.",
    description:
      "Discuss materials, components and supplies for business operations. Clear product standards, quantities and procurement priorities guide the search for a suitable connection.",
  },
  other: {
    title: "Other opportunities",
    kicker: "A WELL-DEFINED BRIEF OPENS THE CONVERSATION.",
    description:
      "Have a different product category, surplus inventory or cross-border partnership in mind? Share the commercial context so we can assess whether ShadowBridge may be a relevant intermediary.",
  },
});

export const roleLabels = Object.freeze({
  buyer: "Buyer / importer",
  supplier: "Supplier / manufacturer",
  agent: "Independent B2B agent",
  partnership: "Other business partner",
});
