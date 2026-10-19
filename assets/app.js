import { industries, roleLabels } from "./content.en.js";

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
const sendButton = document.querySelector("#send-enquiry");
let contactReady = false;
let contactCSRF;
document.querySelector("#download-brief").disabled = false;
document.querySelector("#copy-brief").disabled = false;
const roleSelect = document.querySelector("#enquiry-role");
const status = document.querySelector("#enquiry-status");
document.querySelectorAll("[data-enquiry-role]").forEach((link) =>
  link.addEventListener("click", () => {
    roleSelect.value = ({agent:"partner",partnership:"other"})[link.dataset.enquiryRole] || link.dataset.enquiryRole;
    status.textContent = `Enquiry path selected: ${roleLabels[roleSelect.value]}. Complete your brief below.`;
  }),
);
document.querySelector("#industry-enquiry").addEventListener("click", () => {
  selectedIndustry ||= "food";
  status.textContent = `Sector selected: ${industries[selectedIndustry].title}. Include this sector in your message if relevant.`;
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
    "Prepared using the ShadowBridge business enquiry form.",
  ].join("\n");
}

async function refreshContactCSRF() {
  if (document.body.dataset.contactMode === "unavailable") throw new Error("Static preview");
  const response = await fetch("/api/config", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Backend unavailable");
  const config = await response.json();
  if (config.backendEnabled !== true || !config.csrfToken) throw new Error("Backend unavailable");
  contactCSRF = config.csrfToken;
}
async function enableContact() {
  await refreshContactCSRF();
  contactReady = true;
  sendButton.disabled = false;
  status.textContent = "The private enquiry queue is available. No email app is needed.";
}
enableContact().catch(() => {
  form.querySelectorAll("input,select,textarea,button").forEach(field => { field.disabled = true; });
  status.textContent = "The enquiry queue is unavailable in this preview. Nothing can be submitted. Formal contact is available in Legal Information.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!contactReady || !form.reportValidity()) return;
  const fields = new FormData(form);
  const value = name => String(fields.get(name) || "").trim();
  const payload = {
    name:value("name"), email:value("email"), company:value("company"), role:value("role"),
    message:value("message"), consent:fields.get("consent") === "on", website:value("website"),
  };
  sendButton.disabled = true;
  status.textContent = "Saving your enquiry…";
  try {
    const send = () => fetch("/api/contact", {
      method:"POST", credentials:"same-origin", cache:"no-store",
      headers:{"Content-Type":"application/json","X-CSRF-Token":contactCSRF}, body:JSON.stringify(payload),
    });
    let response = await send();
    let result = await response.json();
    // A different tab can rotate the cookie. CSRF is checked before any write;
    // retry only this explicit rejection, never a timeout or an unknown result.
    if (response.status === 403 && result.code === "csrf_failed") {
      await refreshContactCSRF();
      response = await send();
      result = await response.json();
    }
    if (response.status !== 201 || result.accepted !== true || !/^SB-CONTACT-[a-f0-9-]+$/i.test(result.receipt || "")) {
      throw new Error(result.error || "The enquiry could not be saved.");
    }
    form.reset();
    status.textContent = `Enquiry saved to the private review queue. Receipt: ${result.receipt}. No email has been sent.`;
  } catch (error) {
    status.textContent = `No receipt was confirmed. ${error.message} Your draft is still in the form. Please check with management before resubmitting if the connection was interrupted.`;
  } finally { sendButton.disabled = !contactReady; }
});

document.querySelector("#download-brief").addEventListener("click", () => {
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

// Keep the public footer year current.
document.querySelector("#copyright-year").textContent = String(
  new Date().getFullYear(),
);
