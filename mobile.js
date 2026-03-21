const mobileCoverImage = document.getElementById("mobileCoverImage");
const mobileStartReadingBtn = document.getElementById("mobileStartReadingBtn");

const READER_URL = "./reader.html";
const EXIT_DELAY_MS = 220;

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

if (mobileStartReadingBtn) {
  mobileStartReadingBtn.addEventListener("click", startReading);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startReading();
  }
});

loadMobileCover();
