const readerTitle = document.getElementById("mobileReaderTitle");
const readerPageShell = document.getElementById("mobileReaderPageShell");
const readerPage = document.getElementById("mobileReaderPage");
const readerPageContent = document.getElementById("mobileReaderPageContent");
const prevPageBtn = document.getElementById("mobileReaderPrevBtn");
const nextPageBtn = document.getElementById("mobileReaderNextBtn");
const settingsBtn = document.getElementById("mobileReaderSettingsBtn");
const menuSheet = document.getElementById("mobileReaderMenuSheet");
const menuBackdrop = document.getElementById("mobileReaderMenuBackdrop");
const menuPanel = menuSheet?.querySelector(".menu-sheet-panel") || null;
const homeBtn = document.getElementById("mobileReaderHomeBtn");
const toggleTocBtn = document.getElementById("mobileReaderToggleTocBtn");
const tocPanel = document.getElementById("mobileReaderTocPanel");
const tocList = document.getElementById("mobileReaderTocList");
const toggleSettingsBtn = document.getElementById("mobileReaderToggleSettingsBtn");
const settingsPanel = document.getElementById("mobileReaderSettingsPanel");
const resetSettingsBtn = document.getElementById("mobileReaderResetSettingsBtn");
const pageToneSelect = document.getElementById("mobileReaderPageToneSelect");
const pageToneTrigger = document.getElementById("mobileReaderPageToneTrigger");
const pageToneTriggerText = document.getElementById("mobileReaderPageToneTriggerText");
const pageToneOptions = document.getElementById("mobileReaderPageToneOptions");
const pageToneOptionButtons = Array.from(document.querySelectorAll(".custom-select-option[data-value]"));
const fontSizeInput = document.getElementById("fontSizeInput");
const lineHeightInput = document.getElementById("lineHeightInput");
const pagePadYInput = document.getElementById("pagePadYInput");
const sidePaddingInput = document.getElementById("sidePaddingInput");
const fontSizeValue = document.getElementById("fontSizeValue");
const lineHeightValue = document.getElementById("lineHeightValue");
const pagePadYValue = document.getElementById("pagePadYValue");
const sidePaddingValue = document.getElementById("sidePaddingValue");

const FALLBACK_BOOK = {
  title: "진화의 특이점",
  blocks: [
    { type: "text", text: "콘텐츠를 불러오지 못했습니다." },
    { type: "text", text: "잠시 후 다시 시도해 주세요." }
  ]
};
const READER_SETTINGS_KEY = "mobile_reader_settings_v1";
const MAX_BOOK_JSON_CHARS = 2_000_000;
const PAGINATION_BASE_SAFETY_RATIO = 0.14;
const PAGE_SWIPE_THRESHOLD_PX = 44;
const PAGE_SWIPE_VERTICAL_LIMIT_PX = 72;
const PAGE_SWIPE_DOMINANCE_RATIO = 1.15;
const BOOK_SAFETY_LIMITS = Object.freeze({
  maxBlocks: 600,
  maxTextCharsPerBlock: 12000,
  maxChapterChars: 240,
  maxCaptionChars: 600,
  maxAltChars: 300,
  maxTotalTextChars: 400000
});
const PAGE_TONE_MAP = Object.freeze({
  white: {
    label: "화이트",
    page: "#ffffff",
    topbar: "rgba(255, 255, 255, 0.95)"
  },
  default: {
    label: "아이보리",
    page: "#fffdfa",
    topbar: "rgba(255, 253, 250, 0.95)"
  },
  warm: {
    label: "베이지",
    page: "#f8f1e3",
    topbar: "rgba(248, 241, 227, 0.95)"
  }
});

let hasManualSettings = false;
let currentPageTone = "white";
let sourceBlocks = [];
let pages = [];
let tocEntries = [];
let activeTocIndex = 0;
let currentPageIndex = 0;
let measureEl = null;
let repaginateFrame = 0;
let repaginateRetryCount = 0;
const imageMeta = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getResponsiveDefaults() {
  const width = Math.max(window.innerWidth || 390, 320);
  const ratio = clamp(width / 390, 0.86, 1.25);

  return {
    pageTone: "white",
    fontSize: clamp(Math.round(18 * ratio), 14, 26),
    lineHeight: 1.9,
    pagePadY: clamp(Math.round(22 * ratio), 12, 56),
    sidePadding: clamp(Math.round(35 * ratio), 12, 80)
  };
}

function getSettingsFromInputs() {
  const defaults = getResponsiveDefaults();
  return {
    pageTone: PAGE_TONE_MAP[currentPageTone] ? currentPageTone : defaults.pageTone,
    fontSize: clamp(Number(fontSizeInput?.value || defaults.fontSize), 14, 26),
    lineHeight: clamp(Number(lineHeightInput?.value || defaults.lineHeight), 1.4, 2.2),
    pagePadY: clamp(Number(pagePadYInput?.value || defaults.pagePadY), 12, 56),
    sidePadding: clamp(Number(sidePaddingInput?.value || defaults.sidePadding), 12, 80)
  };
}

function syncPageToneControl() {
  const toneKey = PAGE_TONE_MAP[currentPageTone] ? currentPageTone : "white";
  const tone = PAGE_TONE_MAP[toneKey];

  if (pageToneTriggerText) {
    pageToneTriggerText.textContent = tone.label;
  }

  pageToneOptionButtons.forEach((button) => {
    const isSelected = button.dataset.value === toneKey;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function applyReaderSettings(settings) {
  const defaults = getResponsiveDefaults();
  const toneKey = PAGE_TONE_MAP[settings?.pageTone] ? settings.pageTone : defaults.pageTone;
  const tone = PAGE_TONE_MAP[toneKey];
  const fontSize = clamp(Number(settings?.fontSize || defaults.fontSize), 14, 26);
  const lineHeight = clamp(Number(settings?.lineHeight || defaults.lineHeight), 1.4, 2.2);
  const pagePadY = clamp(Number(settings?.pagePadY || defaults.pagePadY), 12, 56);
  const sidePadding = clamp(Number(settings?.sidePadding || defaults.sidePadding), 12, 80);

  currentPageTone = toneKey;
  document.documentElement.style.setProperty("--reader-page-bg", tone.page);
  document.documentElement.style.setProperty("--reader-topbar-bg", tone.topbar);
  document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
  document.documentElement.style.setProperty("--reader-line-height", lineHeight.toFixed(1));
  document.documentElement.style.setProperty("--reader-vertical-padding", `${pagePadY}px`);
  document.documentElement.style.setProperty("--reader-side-padding", `${sidePadding}px`);

  if (fontSizeInput) {
    fontSizeInput.value = String(fontSize);
  }
  if (lineHeightInput) {
    lineHeightInput.value = lineHeight.toFixed(1);
  }
  if (pagePadYInput) {
    pagePadYInput.value = String(pagePadY);
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
  if (pagePadYValue) {
    pagePadYValue.textContent = `${pagePadY}px`;
  }
  if (sidePaddingValue) {
    sidePaddingValue.textContent = `${sidePadding}px`;
  }

  syncPageToneControl();
}

function updateReaderPageViewportSize() {
  if (!readerPageShell) {
    return;
  }

  const rect = readerPageShell.getBoundingClientRect();
  const style = window.getComputedStyle(readerPageShell);
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  const padRight = Number.parseFloat(style.paddingRight) || 0;
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const padBottom = Number.parseFloat(style.paddingBottom) || 0;
  const innerWidth = Math.max(0, rect.width - padLeft - padRight);
  const innerHeight = Math.max(0, rect.height - padTop - padBottom);

  readerPageShell.style.setProperty("--reader-fit-width", `${innerWidth.toFixed(2)}px`);
  readerPageShell.style.setProperty("--reader-fit-height", `${innerHeight.toFixed(2)}px`);
}

function requestRepaginate(anchorPageIndex = currentPageIndex, isRetry = false) {
  if (!isRetry) {
    repaginateRetryCount = 0;
  }

  if (repaginateFrame) {
    window.cancelAnimationFrame(repaginateFrame);
  }

  repaginateFrame = window.requestAnimationFrame(() => {
    repaginateFrame = 0;
    const didRebuild = rebuildPages(anchorPageIndex);
    if (didRebuild) {
      repaginateRetryCount = 0;
      return;
    }

    if (sourceBlocks.length && repaginateRetryCount < 2) {
      repaginateRetryCount += 1;
      requestRepaginate(anchorPageIndex, true);
    }
  });
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

function closePageToneOptions() {
  if (!pageToneSelect || !pageToneTrigger || !pageToneOptions) {
    return;
  }
  pageToneSelect.classList.remove("is-open");
  pageToneOptions.classList.add("hidden");
  pageToneTrigger.setAttribute("aria-expanded", "false");
}

function togglePageToneOptions() {
  if (!pageToneSelect || !pageToneTrigger || !pageToneOptions) {
    return;
  }
  const nextOpen = pageToneOptions.classList.contains("hidden");
  pageToneSelect.classList.toggle("is-open", nextOpen);
  pageToneOptions.classList.toggle("hidden", !nextOpen);
  pageToneTrigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

function setPanelState(panel, trigger, isOpen) {
  if (!panel || !trigger) {
    return;
  }
  panel.classList.toggle("is-open", isOpen);
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");

  if (trigger === toggleSettingsBtn && resetSettingsBtn) {
    resetSettingsBtn.disabled = !isOpen;
    resetSettingsBtn.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }
}

function closeTocPanel() {
  setPanelState(tocPanel, toggleTocBtn, false);
}

function closeSettingsPanel() {
  closePageToneOptions();
  setPanelState(settingsPanel, toggleSettingsBtn, false);
}

function toggleTocPanel() {
  if (!tocPanel || !toggleTocBtn) {
    return;
  }
  const willOpen = !tocPanel.classList.contains("is-open");
  closeSettingsPanel();
  setPanelState(tocPanel, toggleTocBtn, willOpen);
}

function toggleSettingsPanel() {
  if (!settingsPanel || !toggleSettingsBtn) {
    return;
  }
  const willOpen = !settingsPanel.classList.contains("is-open");
  closeTocPanel();
  setPanelState(settingsPanel, toggleSettingsBtn, willOpen);
  if (!willOpen) {
    closePageToneOptions();
  }
}

function closeQuickMenu() {
  if (!menuSheet || !settingsBtn) {
    return;
  }
  closeTocPanel();
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

  if (!willOpen) {
    closeQuickMenu();
    return;
  }

  closeTocPanel();
  closeSettingsPanel();
  menuSheet.classList.remove("hidden");
  menuSheet.setAttribute("aria-hidden", "false");
  settingsBtn.setAttribute("aria-expanded", "true");
}

function resetReaderSettings() {
  hasManualSettings = false;
  clearSavedReaderSettings();
  closePageToneOptions();
  applyReaderSettings(getResponsiveDefaults());
  if (sourceBlocks.length) {
    requestRepaginate(currentPageIndex);
  }
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

function clampSafeText(value, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return "";
  }
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function enforceBookSafetyLimits(book) {
  const safe = {
    title:
      clampSafeText(book?.title || FALLBACK_BOOK.title, BOOK_SAFETY_LIMITS.maxChapterChars) ||
      FALLBACK_BOOK.title,
    blocks: []
  };

  const sourceBlocks = Array.isArray(book?.blocks) ? book.blocks : [];
  let remainingTextChars = BOOK_SAFETY_LIMITS.maxTotalTextChars;

  for (const block of sourceBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if (safe.blocks.length >= BOOK_SAFETY_LIMITS.maxBlocks || remainingTextChars <= 0) {
      break;
    }

    if (block.type === "image") {
      const src = sanitizeAssetURL(block.src || "");
      if (!src) {
        continue;
      }
      safe.blocks.push({
        type: "image",
        src,
        mode: block.mode === "inline" ? "inline" : "full",
        alt: clampSafeText(block.alt || "", BOOK_SAFETY_LIMITS.maxAltChars),
        caption: clampSafeText(block.caption || "", BOOK_SAFETY_LIMITS.maxCaptionChars)
      });
      continue;
    }

    if (block.type === "chapter") {
      const titleRaw = clampSafeText(block.title || "", BOOK_SAFETY_LIMITS.maxChapterChars);
      const title = titleRaw.slice(0, remainingTextChars);
      if (!title) {
        continue;
      }
      remainingTextChars -= title.length;
      safe.blocks.push({ type: "chapter", title });
      continue;
    }

    if (block.type === "quote") {
      const textRaw = clampSafeText(
        block.text || block.quote || "",
        BOOK_SAFETY_LIMITS.maxTextCharsPerBlock
      );
      const text = textRaw.slice(0, remainingTextChars);
      if (!text) {
        continue;
      }
      remainingTextChars -= text.length;
      safe.blocks.push({
        type: "quote",
        text,
        author: clampSafeText(
          block.author || block.name || block.person || "",
          BOOK_SAFETY_LIMITS.maxChapterChars
        )
      });
      continue;
    }

    const textRaw = clampSafeText(block.text || "", BOOK_SAFETY_LIMITS.maxTextCharsPerBlock);
    const text = textRaw.slice(0, remainingTextChars);
    if (!text) {
      continue;
    }
    remainingTextChars -= text.length;
    safe.blocks.push({ type: "text", text });
  }

  if (!safe.blocks.length) {
    safe.blocks = FALLBACK_BOOK.blocks
      .map((entry) => ({
        type: entry.type || "text",
        text: clampSafeText(entry?.text || "", BOOK_SAFETY_LIMITS.maxTextCharsPerBlock)
      }))
      .filter((entry) => entry.text);
  }

  if (!safe.blocks.length) {
    safe.blocks = [{ type: "text", text: "내용을 불러올 수 없습니다." }];
  }

  return safe;
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
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({ type: "text", text: value }));
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

  return enforceBookSafetyLimits(normalized);
}

function shouldSkipMobileLeadingBlock(block, index) {
  if (index !== 0 || !block || block.type !== "image" || block.mode !== "full") {
    return false;
  }

  const raw = String(block.src || "").trim();
  if (!raw) {
    return false;
  }

  try {
    const parsed = new URL(raw, window.location.href);
    return /\/assets\/empty\.png$/i.test(parsed.pathname);
  } catch (error) {
    return /(?:^|\/)assets\/empty\.png(?:$|[?#])/i.test(raw);
  }
}

function loadImageMeta(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || 1600,
        height: image.naturalHeight || 900
      });
    };
    image.onerror = () => {
      resolve({ width: 1600, height: 900 });
    };
    image.src = src;
  });
}

async function preloadImageMeta(blocks) {
  imageMeta.clear();
  const imageBlocks = blocks.filter((block) => block.type === "image" && block.src);
  const uniqueSources = [...new Set(imageBlocks.map((block) => block.src))];

  const results = await Promise.all(
    uniqueSources.map(async (src) => ({
      src,
      meta: await loadImageMeta(src)
    }))
  );

  for (const result of results) {
    imageMeta.set(result.src, result.meta);
  }
}

function blockToHTML(block) {
  if (!block) {
    return "";
  }

  if (block.type === "chapter") {
    const title = escapeHTML(block.title || "").replace(/\n/g, "<br>").trim();
    if (!title) {
      return "";
    }
    return `<section class="chapter-break"><h2 class="chapter-title">${title}</h2></section>`;
  }

  if (block.type === "text") {
    return `<p class="paragraph">${escapeHTML(block.text).replace(/\n/g, "<br>")}</p>`;
  }

  if (block.type === "quote") {
    const quoteText = escapeHTML(block.text || block.quote || "").replace(/\n/g, "<br>").trim();
    if (!quoteText) {
      return "";
    }
    const authorText = escapeHTML(block.author || block.name || block.person || "").trim();
    const authorHTML = authorText ? `<p class="quote-author">${authorText}</p>` : "";
    return `<blockquote class="quote-block"><p class="quote-text">${quoteText}</p>${authorHTML}</blockquote>`;
  }

  if (block.type === "image") {
    const safeSrc = sanitizeAssetURL(block.src || "");
    if (!safeSrc) {
      return "";
    }
    const metadata = imageMeta.get(safeSrc);
    const aspectStyle =
      metadata?.width && metadata?.height
        ? ` style="aspect-ratio: ${Math.max(1, metadata.width)} / ${Math.max(1, metadata.height)};"`
        : "";
    const alt = escapeHTML(block.alt || "");
    const src = escapeHTML(safeSrc);
    const caption = block.caption ? `<figcaption>${escapeHTML(block.caption)}</figcaption>` : "";
    const kindClass = block.mode === "full" ? "media-full" : "media-inline";
    return `<figure class="media-block ${kindClass}"><img src="${src}" alt="${alt}" loading="lazy" decoding="async"${aspectStyle} />${caption}</figure>`;
  }

  return "";
}

function blocksToHTML(blocks) {
  if (!blocks || blocks.length === 0) {
    return "<p class=\"paragraph\">내용이 없는 페이지입니다.</p>";
  }

  return blocks.map(blockToHTML).join("");
}

function ensureMeasureElement() {
  if (measureEl) {
    return measureEl;
  }

  measureEl = document.createElement("div");
  measureEl.className = "mobile-reader-page-content";
  measureEl.style.position = "fixed";
  measureEl.style.left = "-10000vw";
  measureEl.style.top = "0";
  measureEl.style.visibility = "hidden";
  measureEl.style.pointerEvents = "none";
  measureEl.style.zIndex = "-1";
  measureEl.style.margin = "0";
  measureEl.style.overflow = "hidden";
  document.body.appendChild(measureEl);
  return measureEl;
}

function setReaderContentStyle(target, pageHeight) {
  if (!target) {
    return;
  }

  const settings = getSettingsFromInputs();
  target.style.fontSize = `${settings.fontSize}px`;
  target.style.lineHeight = settings.lineHeight.toFixed(1);
  target.style.setProperty("--reader-page-inner-height", `${Math.max(0, Number(pageHeight)).toFixed(2)}px`);
}

function getElementInnerSize(element) {
  if (!element) {
    return { width: 0, height: 0 };
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  const padRight = Number.parseFloat(style.paddingRight) || 0;
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const padBottom = Number.parseFloat(style.paddingBottom) || 0;

  return {
    width: Math.max(0, rect.width - padLeft - padRight),
    height: Math.max(0, rect.height - padTop - padBottom)
  };
}

function getReaderPageInnerSize() {
  if (!readerPage) {
    return { width: 0, height: 0 };
  }

  updateReaderPageViewportSize();
  const hadFullImage = readerPage.classList.contains("is-full-image");
  if (hadFullImage) {
    readerPage.classList.remove("is-full-image");
  }

  const size = getElementInnerSize(readerPage);

  if (hadFullImage) {
    readerPage.classList.add("is-full-image");
  }

  return size;
}

function pageFits(candidateBlocks, pageWidth, pageHeight) {
  const probe = ensureMeasureElement();
  probe.style.width = `${Math.max(0, Number(pageWidth)).toFixed(2)}px`;
  probe.style.height = "auto";
  probe.style.minHeight = "0";
  probe.style.maxHeight = "none";
  setReaderContentStyle(probe, pageHeight);
  probe.innerHTML = blocksToHTML(candidateBlocks);

  const computedLineHeight = Number.parseFloat(window.getComputedStyle(probe).lineHeight);
  const settings = getSettingsFromInputs();
  const estimatedLinePx = Number.isFinite(computedLineHeight)
    ? computedLineHeight
    : Math.max(12, settings.fontSize * settings.lineHeight);
  const bottomSafetyPx = Math.max(1, Math.ceil(estimatedLinePx * PAGINATION_BASE_SAFETY_RATIO));
  const measuredHeight = Math.max(probe.scrollHeight, probe.getBoundingClientRect().height);

  return measuredHeight <= Math.max(0, pageHeight - bottomSafetyPx);
}

function chooseTextCutBoundary(text, bestIndex) {
  if (bestIndex <= 1) {
    return 1;
  }

  const head = text.slice(0, bestIndex);
  const candidate = head.search(/\s+[^\s]*$/);

  if (candidate > 24 && candidate > bestIndex * 0.55) {
    return candidate;
  }

  return bestIndex;
}

function findFittingTextCut(text, currentBlocks, pageWidth, pageHeight) {
  let low = 1;
  let high = text.length;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const fragment = text.slice(0, mid).trimEnd();

    if (!fragment) {
      low = mid + 1;
      continue;
    }

    const fits = pageFits([...currentBlocks, { type: "text", text: fragment }], pageWidth, pageHeight);
    if (fits) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best <= 0) {
    return 1;
  }

  return chooseTextCutBoundary(text, best);
}

function refreshTocEntries(fallbackTitle) {
  const entries = [];
  const seenTitles = new Set();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (!page || !Array.isArray(page.blocks)) {
      continue;
    }

    for (const block of page.blocks) {
      if (!block || block.type !== "chapter") {
        continue;
      }

      const title = String(block.title || "").trim();
      if (!title || seenTitles.has(title)) {
        continue;
      }

      seenTitles.add(title);
      entries.push({ title, pageIndex });
    }
  }

  tocEntries = entries.length
    ? entries
    : [{ title: String(fallbackTitle || FALLBACK_BOOK.title).trim() || FALLBACK_BOOK.title, pageIndex: 0 }];
}

function updateTocActiveState() {
  if (!tocList) {
    return;
  }

  const items = tocList.querySelectorAll(".menu-sheet-toc-item");
  items.forEach((item, index) => {
    const isActive = index === activeTocIndex;
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-current", isActive ? "true" : "false");
  });
}

function setActiveTocIndex(index) {
  const safeIndex = clamp(Number(index) || 0, 0, Math.max(tocEntries.length - 1, 0));
  if (safeIndex === activeTocIndex) {
    updateTocActiveState();
    return;
  }

  activeTocIndex = safeIndex;
  updateTocActiveState();
}

function syncActiveTocIndexToCurrentPage() {
  if (tocEntries.length <= 1) {
    setActiveTocIndex(0);
    return;
  }

  let nextIndex = 0;
  for (let index = 0; index < tocEntries.length; index += 1) {
    const entry = tocEntries[index];
    const nextEntry = tocEntries[index + 1];
    if (currentPageIndex >= entry.pageIndex) {
      nextIndex = index;
    }
    if (!nextEntry || currentPageIndex < nextEntry.pageIndex) {
      break;
    }
  }

  setActiveTocIndex(nextIndex);
}

function goToTocEntry(index) {
  const entry = tocEntries[index];
  if (!entry) {
    return;
  }

  goToPage(entry.pageIndex);
  closeQuickMenu();
}

function renderTocList() {
  if (!tocList) {
    return;
  }

  tocList.innerHTML = "";
  if (!tocEntries.length) {
    const empty = document.createElement("p");
    empty.className = "menu-sheet-toc-empty";
    empty.textContent = "목차를 불러올 수 없습니다.";
    tocList.appendChild(empty);
    return;
  }

  tocEntries.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-sheet-toc-item";
    button.textContent = entry.title;
    button.addEventListener("click", () => {
      goToTocEntry(index);
    });
    tocList.appendChild(button);
  });

  updateTocActiveState();
}

function isFullImagePage(page) {
  return !!(
    page &&
    Array.isArray(page.blocks) &&
    page.blocks.length === 1 &&
    page.blocks[0].type === "image" &&
    page.blocks[0].mode === "full"
  );
}

function updateNavButtons() {
  const hasPages = pages.length > 0;

  if (prevPageBtn) {
    prevPageBtn.disabled = !hasPages || currentPageIndex <= 0;
  }
  if (nextPageBtn) {
    nextPageBtn.disabled = !hasPages || currentPageIndex >= pages.length - 1;
  }
}

function renderReaderMessage(message, className = "reader-error") {
  if (!readerPage || !readerPageContent) {
    return;
  }

  readerPage.classList.remove("is-full-image");
  setReaderContentStyle(readerPageContent, getReaderPageInnerSize().height);
  readerPageContent.innerHTML = "";

  const messageElement = document.createElement("p");
  messageElement.className = className;
  messageElement.textContent = message;
  readerPageContent.appendChild(messageElement);
  updateNavButtons();
}

function renderCurrentPage() {
  if (!readerPage || !readerPageContent) {
    return;
  }

  const page = pages[currentPageIndex] || null;
  if (!page) {
    renderReaderMessage("내용이 없습니다.", "reader-loading");
    return;
  }

  const fullImagePage = isFullImagePage(page);
  readerPage.classList.toggle("is-full-image", fullImagePage);
  setReaderContentStyle(readerPageContent, getReaderPageInnerSize().height);
  readerPageContent.innerHTML = blocksToHTML(page.blocks);
  syncActiveTocIndexToCurrentPage();
  updateNavButtons();
}

function goToPage(index) {
  if (!pages.length) {
    return;
  }

  currentPageIndex = clamp(Number(index) || 0, 0, pages.length - 1);
  renderCurrentPage();
}

function bindPageSwipe() {
  if (!readerPage) {
    return;
  }

  let swipeStartX = 0;
  let swipeStartY = 0;
  let isSwipeTracking = false;

  readerPage.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        isSwipeTracking = false;
        return;
      }

      if (menuSheet && !menuSheet.classList.contains("hidden")) {
        isSwipeTracking = false;
        return;
      }

      const touch = event.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      isSwipeTracking = true;
    },
    { passive: true }
  );

  readerPage.addEventListener(
    "touchcancel",
    () => {
      isSwipeTracking = false;
    },
    { passive: true }
  );

  readerPage.addEventListener(
    "touchend",
    (event) => {
      if (!isSwipeTracking || event.changedTouches.length !== 1) {
        isSwipeTracking = false;
        return;
      }

      isSwipeTracking = false;

      if (menuSheet && !menuSheet.classList.contains("hidden")) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - swipeStartX;
      const deltaY = touch.clientY - swipeStartY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX < PAGE_SWIPE_THRESHOLD_PX) {
        return;
      }

      if (absDeltaY > PAGE_SWIPE_VERTICAL_LIMIT_PX) {
        return;
      }

      if (absDeltaX <= absDeltaY * PAGE_SWIPE_DOMINANCE_RATIO) {
        return;
      }

      if (deltaX < 0) {
        goToPage(currentPageIndex + 1);
        return;
      }

      goToPage(currentPageIndex - 1);
    },
    { passive: true }
  );
}

function rebuildPages(anchorAbsolutePage = currentPageIndex) {
  if (!sourceBlocks.length) {
    pages = [];
    currentPageIndex = 0;
    updateNavButtons();
    return true;
  }

  updateReaderPageViewportSize();
  const innerSize = getReaderPageInnerSize();
  const pageWidth = innerSize.width;
  const pageHeight = innerSize.height;

  if (!pageWidth || !pageHeight) {
    return false;
  }

  const queue = sourceBlocks.map((block) => ({ ...block }));
  const rebuilt = [];

  while (queue.length > 0) {
    const pageBlocks = [];

    while (queue.length > 0) {
      const block = queue[0];

      if (block.type === "image" && block.mode === "full") {
        if (pageBlocks.length === 0) {
          pageBlocks.push(block);
          queue.shift();
        }
        break;
      }

      const fitsWhole = pageFits([...pageBlocks, block], pageWidth, pageHeight);
      if (fitsWhole) {
        pageBlocks.push(block);
        queue.shift();
        continue;
      }

      if (block.type === "text") {
        const cut = findFittingTextCut(block.text, pageBlocks, pageWidth, pageHeight);
        const front = block.text.slice(0, cut).trimEnd();
        const rest = block.text.slice(cut).trimStart();
        const frontFits = front
          ? pageFits([...pageBlocks, { ...block, text: front }], pageWidth, pageHeight)
          : false;

        if (front && frontFits) {
          pageBlocks.push({ ...block, text: front });
          if (rest) {
            queue[0] = { ...block, text: rest };
          } else {
            queue.shift();
          }
          continue;
        }
      }

      break;
    }

    if (!pageBlocks.length) {
      const forced = queue.shift();
      if (forced) {
        pageBlocks.push(forced);
      }
    }

    rebuilt.push({ blocks: pageBlocks });
  }

  pages = rebuilt.length
    ? rebuilt
    : [{ blocks: [{ type: "text", text: "내용이 없습니다." }] }];
  currentPageIndex = clamp(anchorAbsolutePage, 0, pages.length - 1);
  refreshTocEntries(readerTitle?.textContent || FALLBACK_BOOK.title);
  syncActiveTocIndexToCurrentPage();
  renderTocList();
  renderCurrentPage();
  return true;
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
  updateReaderPageViewportSize();
  setReaderContentStyle(readerPageContent, getReaderPageInnerSize().height);
  updateNavButtons();
  bindPageSwipe();

  if (settingsBtn) {
    settingsBtn.addEventListener("click", toggleQuickMenu);
  }
  if (menuBackdrop) {
    menuBackdrop.addEventListener("click", closeQuickMenu);
  }
  if (homeBtn) {
    homeBtn.addEventListener("click", (event) => {
      const shouldLeave = window.confirm("홈으로 이동하시겠습니까?");
      if (!shouldLeave) {
        event.preventDefault();
      }
    });
  }
  if (toggleTocBtn) {
    toggleTocBtn.addEventListener("click", toggleTocPanel);
  }
  if (toggleSettingsBtn) {
    toggleSettingsBtn.addEventListener("click", toggleSettingsPanel);
  }
  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener("click", resetReaderSettings);
  }
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      goToPage(currentPageIndex - 1);
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      goToPage(currentPageIndex + 1);
    });
  }
  if (pageToneTrigger) {
    pageToneTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePageToneOptions();
    });
  }
  if (pageToneOptions) {
    pageToneOptions.addEventListener("click", (event) => {
      event.stopPropagation();
      const optionTarget = event.target;
      if (!(optionTarget instanceof Element)) {
        return;
      }

      const optionButton = optionTarget.closest(".custom-select-option[data-value]");
      if (!optionButton) {
        return;
      }

      hasManualSettings = true;
      currentPageTone = optionButton.dataset.value || "white";
      const nextSettings = getSettingsFromInputs();
      applyReaderSettings(nextSettings);
      saveReaderSettings(nextSettings);
      closePageToneOptions();
      if (sourceBlocks.length) {
        requestRepaginate(currentPageIndex);
      }
    });
  }

  const handleInputChange = () => {
    hasManualSettings = true;
    const nextSettings = getSettingsFromInputs();
    applyReaderSettings(nextSettings);
    saveReaderSettings(nextSettings);
    if (sourceBlocks.length) {
      requestRepaginate(currentPageIndex);
    }
  };

  if (fontSizeInput) {
    fontSizeInput.addEventListener("input", handleInputChange);
  }
  if (lineHeightInput) {
    lineHeightInput.addEventListener("input", handleInputChange);
  }
  if (pagePadYInput) {
    pagePadYInput.addEventListener("input", handleInputChange);
  }
  if (sidePaddingInput) {
    sidePaddingInput.addEventListener("input", handleInputChange);
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (
      menuSheet &&
      !menuSheet.classList.contains("hidden") &&
      !menuPanel?.contains(target) &&
      !settingsBtn?.contains(target)
    ) {
      closeQuickMenu();
    }

    if (!pageToneTrigger?.contains(target) && !pageToneOptions?.contains(target)) {
      closePageToneOptions();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (pageToneOptions && !pageToneOptions.classList.contains("hidden")) {
      closePageToneOptions();
      return;
    }

    closeQuickMenu();
  });

  window.addEventListener("resize", () => {
    if (!hasManualSettings) {
      applyReaderSettings(getResponsiveDefaults());
    } else {
      updateReaderPageViewportSize();
    }

    if (sourceBlocks.length) {
      requestRepaginate(currentPageIndex);
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

    const rawText = await response.text();
    if (rawText.length > MAX_BOOK_JSON_CHARS) {
      throw new Error("book meta too large");
    }

    const raw = JSON.parse(rawText);
    const normalized = normalizeBookData(raw);
    sourceBlocks = normalized.blocks
      .filter((block, index) => !shouldSkipMobileLeadingBlock(block, index))
      .map((block) => ({ ...block }));
    setTitle(normalized.title);
    await preloadImageMeta(sourceBlocks);
    requestRepaginate(0);
  } catch (error) {
    setTitle(FALLBACK_BOOK.title);
    sourceBlocks = [];
    pages = [];
    currentPageIndex = 0;
    tocEntries = [{ title: FALLBACK_BOOK.title, pageIndex: 0 }];
    activeTocIndex = 0;
    renderTocList();
    renderReaderMessage("콘텐츠를 불러오지 못했습니다.");
  }
}

initMobileReader();
