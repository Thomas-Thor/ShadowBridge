import { industries, publicContact, roleLabels } from "./content.en.js";

document.documentElement.classList.remove("no-js");

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-nav");
function setMenu(open, restoreFocus = false) {
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
  navigation.classList.toggle("is-open", open);
  if (restoreFocus) menuButton.focus();
}
menuButton.addEventListener("click", () =>
  setMenu(menuButton.getAttribute("aria-expanded") !== "true"),
);
navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    menuButton.getAttribute("aria-expanded") === "true"
  )
    setMenu(false, true);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".header-inner")) setMenu(false);
});
window
  .matchMedia("(min-width: 1001px)")
  .addEventListener("change", () => setMenu(false));

// The page remains fully visible without JavaScript or an animation observer.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const observer = new IntersectionObserver(
    (entries, instance) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-seen");
          instance.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );
  document
    .querySelectorAll(".service-card, .process-grid li, .role-card")
    .forEach((element) => observer.observe(element));
}

let selectedIndustry = null;
const tabs = [...document.querySelectorAll("[data-industry]")];
function selectIndustry(tab, focus = false) {
  const key = tab.dataset.industry;
  const content = industries[key];
  if (!content) return;
  selectedIndustry = key;
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  document
    .querySelector("#industry-panel")
    .setAttribute("aria-labelledby", tab.id);
  document.querySelector("#industry-kicker").textContent = content.kicker;
  document.querySelector("#industry-title").textContent = content.title;
  document.querySelector("#industry-description").textContent =
    content.description;
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectIndustry(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = (index + 1) % tabs.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectIndustry(tabs[next], true);
    }
  });
});

const form = document.querySelector("#enquiry-form");
form.querySelector("button[type=submit]").disabled = false;
document.querySelector("#copy-brief").disabled = false;
const roleSelect = document.querySelector("#enquiry-role");
const status = document.querySelector("#enquiry-status");
document.querySelectorAll("[data-enquiry-role]").forEach((link) =>
  link.addEventListener("click", () => {
    roleSelect.value = link.dataset.enquiryRole;
    status.textContent = `Enquiry path selected: ${roleLabels[roleSelect.value]}. Complete your brief below.`;
  }),
);
document.querySelector("#industry-enquiry").addEventListener("click", () => {
  selectedIndustry ||= "food";
  status.textContent = `Sector selected: ${industries[selectedIndustry].title}. It will be included in your brief.`;
});

function prepareBrief() {
  if (!form.reportValidity()) return null;
  const fields = new FormData(form);
  const value = (name) => String(fields.get(name) || "").trim();
  if (!value("name") || value("message").length < 20) {
    status.textContent =
      "Please enter your name and at least 20 characters describing your opportunity.";
    return null;
  }
  return [
    "SHADOWBRIDGE — BUSINESS ENQUIRY",
    "",
    `Name: ${value("name")}`,
    `Email: ${value("email")}`,
    `Company: ${value("company") || "Not specified"}`,
    `Role: ${roleLabels[value("role")]}`,
    `Sector: ${selectedIndustry ? industries[selectedIndustry].title : "Not specified"}`,
    "",
    "OPPORTUNITY",
    value("message"),
    "",
    "Prepared locally in the ShadowBridge website preview. This brief has not been submitted.",
  ].join("\n");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const brief = prepareBrief();
  if (!brief) return;
  const url = URL.createObjectURL(
    new Blob([brief], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "shadowbridge-enquiry.txt";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent =
    "Your enquiry brief has been downloaded. It has not been sent to ShadowBridge.";
});
document.querySelector("#copy-brief").addEventListener("click", async () => {
  const brief = prepareBrief();
  if (!brief) return;
  try {
    await navigator.clipboard.writeText(brief);
    status.textContent =
      "Brief copied to your clipboard. It has not been sent to ShadowBridge.";
  } catch {
    status.textContent =
      "Clipboard access is unavailable. Use “Download enquiry brief” to save your brief.";
  }
});

// A confirmed address enables a visible contact link, never automatic submission.
if (publicContact.email) {
  const link = document.createElement("a");
  link.href = `mailto:${publicContact.email}`;
  link.textContent = publicContact.email;
  document.querySelector("#business-contact").replaceChildren(link);
}
document.querySelector("#copyright-year").textContent = String(
  new Date().getFullYear(),
);
