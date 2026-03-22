const mobileCoverImage = document.getElementById("mobileCoverImage");
const mobileStartReadingBtn = document.getElementById("mobileStartReadingBtn");
const mobileCopyLinkBtn = document.getElementById("mobileCopyLinkBtn");

const READER_URL = "./mobile-reader.html";
const EXIT_DELAY_MS = 220;
const SHARE_DOMAIN = "evosingularity.com";

function sanitizeAssetURL(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/[\u0000-\u001F]/.test(raw)) {
    return "";
  }
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(raw)) {
    return "";
  }

  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.origin !== window.location.origin) {
      return "";
    }
    if (!/\.(?:png|jpe?g|webp|gif|svg)$/i.test(parsed.pathname)) {
      return "";
    }
  } catch (error) {
    return "";
  }

  return raw;
}

async function loadMobileCover() {
  if (!mobileCoverImage) {
    return;
  }

  try {
    const response = await fetch("./book.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const coverImage = sanitizeAssetURL(data?.coverImage || data?.cover || "");
    if (coverImage) {
      mobileCoverImage.src = coverImage;
    }
  } catch (error) {
    // Keep default cover when meta loading fails.
  }
}

function startReading() {
  document.body.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = READER_URL;
  }, EXIT_DELAY_MS);
}

async function copyLink() {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(SHARE_DOMAIN);
    } else {
      const temp = document.createElement("textarea");
      temp.value = SHARE_DOMAIN;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    }
    window.alert("복사되었습니다.");
  } catch (error) {
    window.alert("복사에 실패했습니다.");
  }
}

if (mobileStartReadingBtn) {
  mobileStartReadingBtn.addEventListener("click", startReading);
}

if (mobileCopyLinkBtn) {
  mobileCopyLinkBtn.addEventListener("click", copyLink);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startReading();
  }
});

loadMobileCover();
