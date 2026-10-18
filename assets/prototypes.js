// Isolated design controls. All values below are fictional and stay in memory.
// No authentication, requests, file reads, storage, analytics or submissions.
const templates = {
  buyer: {
    product: "Recycled aluminium sheet — FICTIONAL EXAMPLE",
    specifications: "Illustrative grade: EN AW-1050A; thickness 2 mm; non-identifying product requirements only.",
    quantity: "20 metric tonnes (demo)",
    budget: "EUR 50,000–60,000 (illustrative)",
    country: "Germany (fictional destination)",
    timeline: "Within 8 weeks (illustrative)",
  },
  supplier: {
    product: "Industrial packaging film — FICTIONAL EXAMPLE",
    specifications: "Illustrative specification: 23 microns, clear recycled-content stretch film. No business identifiers.",
    quantity: "12 metric tonnes (demo)",
    price: "1,250 per metric tonne (illustrative)",
    currency: "EUR",
    moq: "2 metric tonnes (demo)",
    incoterms: "FCA · Incoterms® 2020 (illustrative)",
    availability: "Within 4 weeks (illustrative)",
    delivery: "European distribution region; precise collection address withheld.",
  },
  partner: {
    opportunity: "Regional sourcing requirement — FICTIONAL EXAMPLE",
    description: "Illustrative opportunity for recyclable industrial packaging. Commercial introductions coordinated exclusively by ShadowBridge.",
    region: "Central Europe (illustrative)",
    volume: "Indicative annual requirement: 100 metric tonnes (demo)",
    scope: "Opportunity research and ShadowBridge-coordinated introduction (illustrative)",
  },
};

document.querySelectorAll("[data-proto-template]").forEach((button) => {
  button.disabled = false;
  button.addEventListener("click", () => {
    const template = templates[button.dataset.protoTemplate];
    if (!template) return;
    Object.entries(template).forEach(([name, value]) => {
      const field = document.querySelector(`[data-proto-field="${name}"]`);
      if (field) field.value = value;
    });
    const feedback = document.querySelector("[data-proto-feedback]");
    if (feedback) feedback.textContent = "Fictional template displayed. Nothing has been saved, sent or submitted.";
  });
});

document.querySelectorAll("[data-proto-reset]").forEach((button) => {
  button.disabled = false;
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-proto-field]").forEach((field) => { field.value = ""; });
    const feedback = document.querySelector("[data-proto-feedback]");
    if (feedback) feedback.textContent = "Fictional template cleared. No stored data exists.";
  });
});

document.querySelectorAll("[data-proto-filter]").forEach((filter) => {
  filter.disabled = false;
  filter.addEventListener("change", () => {
    const group = filter.dataset.protoFilter;
    let count = 0;
    document.querySelectorAll(`[data-proto-group="${group}"]`).forEach((record) => {
      record.hidden = filter.value !== "all" && record.dataset.protoStatus !== filter.value;
      if (!record.hidden) count += 1;
    });
    const feedback = document.querySelector(`[data-proto-filter-feedback="${group}"]`);
    if (feedback) feedback.textContent = `${count} fictional ${count === 1 ? "item" : "items"} shown. This is a design filter only.`;
  });
});
