const readerRoot = document.getElementById("mobileReader");
const readerTitle = document.getElementById("mobileReaderTitle");
const settingsBtn = document.getElementById("mobileReaderSettingsBtn");
const menuSheet = document.getElementById("mobileReaderMenuSheet");
const menuBackdrop = document.getElementById("mobileReaderMenuBackdrop");
const menuQuickView = document.getElementById("mobileReaderMenuQuick");
const openSettingsBtn = document.getElementById("mobileReaderOpenSettingsBtn");
const settingsPanel = document.getElementById("mobileReaderSettings");
const resetSettingsBtn = document.getElementById("mobileReaderResetSettingsBtn");
const fontSizeInput = document.getElementById("fontSizeInput");
const lineHeightInput = document.getElementById("lineHeightInput");
const sidePaddingInput = document.getElementById("sidePaddingInput");
const fontSizeValue = document.getElementById("fontSizeValue");
const lineHeightValue = document.getElementById("lineHeightValue");
const sidePaddingValue = document.getElementById("sidePaddingValue");

const FALLBACK_BOOK = {
  title: "진화의 특이점",
  blocks: [
    { type: "text", text: "콘텐츠를 불러오지 못했습니다." },
    { type: "text", text: "잠시 후 다시 시도해 주세요." }
  ]
};
const READER_SETTINGS_KEY = "mobile_reader_settings_v1";
let hasManualSettings = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getResponsiveDefaults() {
  const width = Math.max(window.innerWidth || 390, 320);
  const ratio = clamp(width / 390, 0.86, 1.25);

  return {
    fontSize: clamp(Math.round(18 * ratio), 14, 26),
    lineHeight: 1.9,
    sidePadding: clamp(Math.round(35 * ratio), 12, 80)
  };
}

function getSettingsFromInputs() {
  const defaults = getResponsiveDefaults();
  return {
    fontSize: clamp(Number(fontSizeInput?.value || defaults.fontSize), 14, 26),
    lineHeight: clamp(Number(lineHeightInput?.value || defaults.lineHeight), 1.4, 2.2),
    sidePadding: clamp(Number(sidePaddingInput?.value || defaults.sidePadding), 12, 80)
  };
}

function applyReaderSettings(settings) {
  const defaults = getResponsiveDefaults();
  const fontSize = clamp(Number(settings?.fontSize || defaults.fontSize), 14, 26);
  const lineHeight = clamp(Number(settings?.lineHeight || defaults.lineHeight), 1.4, 2.2);
  const sidePadding = clamp(Number(settings?.sidePadding || defaults.sidePadding), 12, 80);

  document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
  document.documentElement.style.setProperty("--reader-line-height", lineHeight.toFixed(1));
  document.documentElement.style.setProperty("--reader-side-padding", `${sidePadding}px`);

  if (fontSizeInput) {
    fontSizeInput.value = String(fontSize);
  }
  if (lineHeightInput) {
    lineHeightInput.value = lineHeight.toFixed(1);
  }
  if (sidePaddingInput) {
    sidePaddingInput.value = String(sidePadding);
  }
  if (fontSizeValue) {
    fontSizeValue.textContent = `${fontSize}px`;
  }
  if (lineHeightValue) {
    lineHeightValue.textContent = lineHeight.toFixed(1);
  }
  if (sidePaddingValue) {
    sidePaddingValue.textContent = `${sidePadding}px`;
  }
}

function saveReaderSettings(settings) {
  try {
    localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // ignore storage errors
  }
}

function loadReaderSettings() {
  try {
    const raw = localStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function clearSavedReaderSettings() {
  try {
    localStorage.removeItem(READER_SETTINGS_KEY);
  } catch (error) {
    // ignore storage errors
  }
}

function resetReaderSettings() {
  hasManualSettings = false;
  clearSavedReaderSettings();
  applyReaderSettings(getResponsiveDefaults());
}

function closeSettingsPanel() {
  if (!settingsPanel || !menuQuickView) {
    return;
  }
  settingsPanel.classList.add("hidden");
  menuQuickView.classList.remove("hidden");
}

function openSettingsPanel() {
  if (!settingsPanel || !menuQuickView) {
    return;
  }
  menuQuickView.classList.add("hidden");
  settingsPanel.classList.remove("hidden");
}

function closeQuickMenu() {
  if (!menuSheet || !settingsBtn) {
    return;
  }
  closeSettingsPanel();
  menuSheet.classList.add("hidden");
  menuSheet.setAttribute("aria-hidden", "true");
  settingsBtn.setAttribute("aria-expanded", "false");
}

function toggleQuickMenu() {
  if (!menuSheet || !settingsBtn) {
    return;
  }
  const willOpen = menuSheet.classList.contains("hidden");
  if (willOpen) {
    closeSettingsPanel();
  }
  menuSheet.classList.toggle("hidden", !willOpen);
  menuSheet.setAttribute("aria-hidden", willOpen ? "false" : "true");
  settingsBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

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

function normalizeBookData(raw) {
  const normalized = {
    title: String(raw?.title || raw?.tocTitle || FALLBACK_BOOK.title).trim() || FALLBACK_BOOK.title,
    blocks: []
  };

  let content = raw?.content;
  if (!Array.isArray(content)) {
    if (typeof content === "string") {
      content = content
        .split(/\n{2,}/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => ({ type: "text", text: v }));
    } else if (Array.isArray(raw?.pages)) {
      content = raw.pages.map((entry) => {
        if (typeof entry === "string") {
          return { type: "text", text: entry };
        }
        return { type: "text", text: String(entry?.text || "").trim() };
      });
    } else {
      content = FALLBACK_BOOK.blocks.map((entry) => ({ ...entry }));
    }
  }

  for (const entry of content) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) {
        normalized.blocks.push({ type: "text", text });
      }
      continue;
    }

    if (!entry || typeof entry !== "object") {
      continue;
    }

    if (typeof entry.chapterTitle === "string" && entry.chapterTitle.trim()) {
      normalized.blocks.push({ type: "chapter", title: entry.chapterTitle.trim() });
      continue;
    }

    if (entry.type === "chapter" || entry.type === "section" || entry.type === "heading") {
      const headingText =
        typeof entry.title === "string"
          ? entry.title.trim()
          : typeof entry.text === "string"
          ? entry.text.trim()
          : "";
      const chapterBody =
        typeof entry.content === "string"
          ? entry.content.trim()
          : typeof entry.body === "string"
          ? entry.body.trim()
          : "";

      if (headingText) {
        normalized.blocks.push({ type: "chapter", title: headingText });
      }
      if (chapterBody) {
        normalized.blocks.push({ type: "text", text: chapterBody });
      }
      continue;
    }

    if (entry.type === "quote" || entry.quote != null || entry.author != null || entry.name != null) {
      const quoteText = String(entry.text ?? entry.quote ?? entry.content ?? "").trim();
      if (quoteText) {
        normalized.blocks.push({
          type: "quote",
          text: quoteText,
          author: String(entry.author ?? entry.name ?? "").trim()
        });
      }
      continue;
    }

    if (entry.type === "image") {
      const src = sanitizeAssetURL(entry.src);
      if (!src) {
        continue;
      }
      normalized.blocks.push({
        type: "image",
        src,
        mode: entry.mode === "inline" ? "inline" : "full",
        alt: String(entry.alt || "").trim(),
        caption: String(entry.caption || "").trim()
      });
      continue;
    }

    const text = String(entry.text ?? entry.content ?? "").trim();
    if (text) {
      normalized.blocks.push({ type: "text", text });
    }
  }

  if (!normalized.blocks.length) {
    normalized.blocks = FALLBACK_BOOK.blocks.map((entry) => ({ ...entry }));
  }

  return normalized;
}

function createTextBlock(text) {
  const section = document.createElement("section");
  section.className = "reader-text";

  const paragraphs = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);

  const source = paragraphs.length ? paragraphs : [String(text || "").trim()];
  for (const paragraphText of source) {
    if (!paragraphText) {
      continue;
    }
    const paragraph = document.createElement("p");
    paragraph.className = "reader-paragraph";
    paragraph.textContent = paragraphText;
    section.appendChild(paragraph);
  }

  return section;
}

function createChapterBlock(title) {
  const section = document.createElement("section");
  section.className = "reader-chapter";
  const heading = document.createElement("h2");
  heading.className = "reader-chapter-title";
  heading.textContent = String(title || "").trim();
  section.appendChild(heading);
  return section;
}

function createQuoteBlock(text, author) {
  const blockquote = document.createElement("blockquote");
  blockquote.className = "reader-quote";

  const quoteText = document.createElement("p");
  quoteText.className = "reader-quote-text";
  quoteText.textContent = text;
  blockquote.appendChild(quoteText);

  if (author) {
    const quoteAuthor = document.createElement("p");
    quoteAuthor.className = "reader-quote-author";
    quoteAuthor.textContent = `- ${author}`;
    blockquote.appendChild(quoteAuthor);
  }

  return blockquote;
}

function createImageBlock(block) {
  const figure = document.createElement("figure");
  figure.className = `reader-figure mode-${block.mode || "full"}`;

  const image = document.createElement("img");
  image.className = "reader-image";
  image.src = block.src;
  image.alt = block.alt || "";
  image.loading = "lazy";
  image.decoding = "async";
  figure.appendChild(image);

  if (block.caption) {
    const figcaption = document.createElement("figcaption");
    figcaption.className = "reader-caption";
    figcaption.textContent = block.caption;
    figure.appendChild(figcaption);
  }

  return figure;
}

function renderBook(book) {
  if (!readerRoot) {
    return;
  }

  readerRoot.innerHTML = "";
  for (const block of book.blocks) {
    if (block.type === "chapter") {
      readerRoot.appendChild(createChapterBlock(block.title));
      continue;
    }

    if (block.type === "quote") {
      readerRoot.appendChild(createQuoteBlock(block.text, block.author));
      continue;
    }

    if (block.type === "image") {
      readerRoot.appendChild(createImageBlock(block));
      continue;
    }

    if (block.type === "text") {
      readerRoot.appendChild(createTextBlock(block.text));
    }
  }
}

function setTitle(title) {
  const safeTitle = String(title || FALLBACK_BOOK.title).trim() || FALLBACK_BOOK.title;
  document.title = `${safeTitle} | 모바일 리더`;
  if (readerTitle) {
    readerTitle.textContent = safeTitle;
  }
}

function bindReaderSettings() {
  const storedSettings = loadReaderSettings();
  const initialSettings = storedSettings || getResponsiveDefaults();
  if (storedSettings) {
    hasManualSettings = true;
  }
  applyReaderSettings(initialSettings);

  if (settingsBtn) {
    settingsBtn.addEventListener("click", toggleQuickMenu);
  }
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      openSettingsPanel();
    });
  }
  if (menuBackdrop) {
    menuBackdrop.addEventListener("click", closeQuickMenu);
  }
  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener("click", resetReaderSettings);
  }

  const handleInputChange = () => {
    hasManualSettings = true;
    const nextSettings = getSettingsFromInputs();
    applyReaderSettings(nextSettings);
    saveReaderSettings(nextSettings);
  };

  if (fontSizeInput) {
    fontSizeInput.addEventListener("input", handleInputChange);
  }
  if (lineHeightInput) {
    lineHeightInput.addEventListener("input", handleInputChange);
  }
  if (sidePaddingInput) {
    sidePaddingInput.addEventListener("input", handleInputChange);
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;

    if (
      menuSheet &&
      !menuSheet.classList.contains("hidden") &&
      !menuSheet.querySelector(".menu-sheet-panel")?.contains(target) &&
      !settingsBtn?.contains(target)
    ) {
      closeQuickMenu();
    }

  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeQuickMenu();
      closeSettingsPanel();
    }
  });

  window.addEventListener("resize", () => {
    if (!hasManualSettings) {
      applyReaderSettings(getResponsiveDefaults());
    }
  });
}

async function initMobileReader() {
  bindReaderSettings();
  try {
    const response = await fetch("./book.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("book meta fetch failed");
    }

    const raw = await response.json();
    const normalized = normalizeBookData(raw);
    setTitle(normalized.title);
    renderBook(normalized);
  } catch (error) {
    setTitle(FALLBACK_BOOK.title);
    if (readerRoot) {
      readerRoot.innerHTML = "";
      const message = document.createElement("p");
      message.className = "reader-error";
      message.textContent = "콘텐츠를 불러오지 못했습니다.";
      readerRoot.appendChild(message);
    }
  }
}

initMobileReader();
