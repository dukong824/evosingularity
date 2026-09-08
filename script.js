import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdfjs/pdf.worker.min.mjs",
  window.location.href
).href;

const DEFAULT_BOOK = Object.freeze({
  title: "진화의 특이점",
  tocTitle: "목차",
  pdfUrl: "assets/book.pdf",
  chapters: [{ title: "처음부터", page: 1 }]
});

const MAX_BOOK_JSON_CHARS = 2_000_000;
const MAX_TOC_ENTRIES = 200;
const SETTINGS_MENU_SCROLL_UNLOCK_MS = 280;
const PASSIVE_POINTER_OPTIONS = { passive: true };

const controls = document.getElementById("controls");
const controlsTocPanel = document.getElementById("controlsTocPanel");
const homeBtn = document.getElementById("homeBtn");
const settingsTabBtn = document.getElementById("settingsTabBtn");
const settingsMenu = document.querySelector(".settings-menu");
const spreadWrap = document.querySelector(".spread-wrap");
const spreadFrame = document.querySelector(".spread-frame");
const spread = document.querySelector(".spread");
const leftPage = document.getElementById("leftPage");
const rightPage = document.getElementById("rightPage");
const leftContent = document.getElementById("leftContent");
const rightContent = document.getElementById("rightContent");
const leftPageNumber = document.getElementById("leftPageNumber");
const rightPageNumber = document.getElementById("rightPageNumber");
const readingMeta = document.getElementById("readingMeta");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const toggleTocBtn = document.getElementById("toggleTocBtn");
const fullscreenIcon = document.getElementById("fullscreenIcon");
const fullscreenLabel = document.getElementById("fullscreenLabel");
const tocList = document.getElementById("tocList");

let bookMeta = { ...DEFAULT_BOOK };
let pdfDocument = null;
let totalPages = 0;
let spreadIndex = 0;
let tocEntries = DEFAULT_BOOK.chapters.map((entry) => ({ ...entry }));
let showControls = false;
let showTocPanel = false;
let renderSequence = 0;
let resizeRaf = 0;
let settingsMenuScrollUnlockTimer = null;
let spreadAspectRatio = Math.SQRT2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampText(value, maxChars = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function sanitizePDFURL(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\u0000-\u001F]/.test(raw)) {
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
    if (!/\.pdf$/i.test(parsed.pathname)) {
      return "";
    }
  } catch (error) {
    return "";
  }

  return raw;
}

function parsePageNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 1;
  }
  return Math.max(1, Math.floor(number));
}

function normalizeChapter(entry, fallbackIndex) {
  if (typeof entry === "string") {
    return {
      title: clampText(entry) || `챕터 ${fallbackIndex + 1}`,
      page: 1
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const title =
    clampText(entry.title || entry.chapterTitle || entry.chapter || entry.label || entry.name) ||
    `챕터 ${fallbackIndex + 1}`;
  const page = parsePageNumber(
    entry.page ?? entry.pageNumber ?? entry.startPage ?? entry.pdfPage ?? entry.index
  );

  return { title, page };
}

function normalizeChapters(raw) {
  const source = Array.isArray(raw?.chapters)
    ? raw.chapters
    : Array.isArray(raw?.toc)
    ? raw.toc
    : Array.isArray(raw?.index)
    ? raw.index
    : [];

  const seen = new Set();
  const chapters = [];

  source.slice(0, MAX_TOC_ENTRIES).forEach((entry, index) => {
    const normalized = normalizeChapter(entry, index);
    if (!normalized) {
      return;
    }

    const key = `${normalized.title}\u0000${normalized.page}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    chapters.push(normalized);
  });

  if (!chapters.length) {
    return DEFAULT_BOOK.chapters.map((entry) => ({ ...entry }));
  }

  return chapters
    .map((entry, index) => ({ ...entry, order: index }))
    .sort((a, b) => a.page - b.page || a.order - b.order)
    .map(({ order, ...entry }) => entry);
}

function normalizeBookData(raw) {
  const title = clampText(raw?.title || raw?.tocTitle || DEFAULT_BOOK.title) || DEFAULT_BOOK.title;
  const tocTitle = clampText(raw?.tocTitle || "목차") || "목차";
  const pdfUrl =
    sanitizePDFURL(raw?.pdfUrl || raw?.pdf || raw?.pdfFile || raw?.file || raw?.src) ||
    DEFAULT_BOOK.pdfUrl;

  return {
    title,
    tocTitle,
    pdfUrl,
    chapters: normalizeChapters(raw)
  };
}

async function loadBookMeta() {
  try {
    const response = await fetch("./book.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`book.json HTTP ${response.status}`);
    }

    const rawText = await response.text();
    if (rawText.length > MAX_BOOK_JSON_CHARS) {
      throw new Error("book.json is too large");
    }

    return normalizeBookData(JSON.parse(rawText));
  } catch (error) {
    return { ...DEFAULT_BOOK, chapters: DEFAULT_BOOK.chapters.map((entry) => ({ ...entry })) };
  }
}

function setBookTitle(title) {
  const safeTitle = clampText(title || DEFAULT_BOOK.title) || DEFAULT_BOOK.title;
  document.title = safeTitle;
}

function getTotalSpreads() {
  return Math.max(1, Math.ceil((Math.max(totalPages, 1) + 1) / 2));
}

function getSpreadPageNumbers() {
  const left = spreadIndex * 2;
  return { left, right: left + 1 };
}

function getPrimaryPageNumber() {
  const { left, right } = getSpreadPageNumbers();
  return left >= 1 ? left : right;
}

function getCurrentChapterTitle(pageNumber) {
  let currentTitle = bookMeta.tocTitle || DEFAULT_BOOK.tocTitle;

  for (const entry of tocEntries) {
    if (pageNumber >= entry.page) {
      currentTitle = entry.title;
    } else {
      break;
    }
  }

  return currentTitle;
}

function setMessage(contentEl, message, className = "pdf-page-message") {
  if (!contentEl) {
    return;
  }

  const messageElement = document.createElement("p");
  messageElement.className = className;
  messageElement.textContent = message;
  contentEl.replaceChildren(messageElement);
}

function fitSpreadToViewport() {
  if (!spreadWrap || !spread) {
    return;
  }

  const ratio = spreadAspectRatio;
  const wrapStyle = window.getComputedStyle(spreadWrap);
  const wrapPadLeft = Number.parseFloat(wrapStyle.paddingLeft) || 0;
  const wrapPadRight = Number.parseFloat(wrapStyle.paddingRight) || 0;
  const wrapPadTop = Number.parseFloat(wrapStyle.paddingTop) || 0;
  const wrapPadBottom = Number.parseFloat(wrapStyle.paddingBottom) || 0;
  const frameStyle = spreadFrame ? window.getComputedStyle(spreadFrame) : null;
  const framePadBottom = frameStyle ? Number.parseFloat(frameStyle.paddingBottom) || 0 : 0;
  const availableWidth = Math.max(0, spreadWrap.clientWidth - wrapPadLeft - wrapPadRight);
  const availableHeight = Math.max(
    0,
    spreadWrap.clientHeight - wrapPadTop - wrapPadBottom - framePadBottom
  );

  let width = availableWidth;
  let height = width / ratio;

  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }

  spread.style.width = `${Math.floor(width)}px`;
  spread.style.height = `${Math.floor(height)}px`;
}

function getRenderSize(contentEl) {
  if (!contentEl) {
    return { width: 0, height: 0 };
  }

  const rect = contentEl.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

async function syncSpreadAspectRatio() {
  if (!pdfDocument || totalPages < 1) {
    return;
  }

  const firstPage = await pdfDocument.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });
  const ratio = (viewport.width * 2) / viewport.height;

  if (Number.isFinite(ratio) && ratio > 0) {
    spreadAspectRatio = ratio;
  }
}

function setPageNumberLabels(leftNumber, rightNumber) {
  if (leftPageNumber) {
    leftPageNumber.textContent =
      leftNumber >= 1 && leftNumber <= totalPages ? String(leftNumber) : "";
  }
  if (rightPageNumber) {
    rightPageNumber.textContent =
      rightNumber >= 1 && rightNumber <= totalPages ? String(rightNumber) : "";
  }
}

function normalizeTocPages() {
  const maxPage = Math.max(totalPages, 1);
  tocEntries = bookMeta.chapters.map((entry) => ({
    title: entry.title,
    page: clamp(parsePageNumber(entry.page), 1, maxPage)
  }));
}

function renderTocList() {
  if (!tocList) {
    return;
  }

  tocList.innerHTML = "";
  const currentPage = getPrimaryPageNumber();

  tocEntries.forEach((entry, index) => {
    const nextEntry = tocEntries[index + 1];
    const isActive =
      currentPage >= entry.page &&
      (!nextEntry || currentPage < nextEntry.page);

    const item = document.createElement("button");
    const title = document.createElement("span");
    const page = document.createElement("span");

    item.type = "button";
    item.className = "toc-item";
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-current", isActive ? "true" : "false");
    title.className = "toc-item-title";
    page.className = "toc-item-page";
    title.textContent = entry.title;
    page.textContent = `${entry.page}쪽`;
    item.append(title, page);
    item.addEventListener("click", () => {
      goToPage(entry.page);
      showControls = false;
      showTocPanel = false;
      renderShell();
    });

    tocList.appendChild(item);
  });
}

function updateMenuState() {
  if (controls) {
    controls.classList.toggle("hidden", !showControls);
  }
  if (settingsMenu) {
    settingsMenu.classList.toggle("is-open", showControls);
    if (!showControls) {
      setSettingsMenuScrollReady(false);
    }
  }
  if (controlsTocPanel) {
    const isTocOpen = showControls && showTocPanel;
    controlsTocPanel.classList.toggle("is-open", isTocOpen);
    controlsTocPanel.setAttribute("aria-hidden", isTocOpen ? "false" : "true");
  }
  if (settingsTabBtn) {
    settingsTabBtn.setAttribute("aria-expanded", showControls ? "true" : "false");
  }
  if (toggleTocBtn) {
    toggleTocBtn.setAttribute("aria-expanded", showControls && showTocPanel ? "true" : "false");
  }
}

function updateNavButtons() {
  const totalSpreads = getTotalSpreads();

  if (prevBtn) {
    prevBtn.disabled = !pdfDocument || spreadIndex <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = !pdfDocument || spreadIndex >= totalSpreads - 1;
  }
}

function updateReadingMeta() {
  if (!readingMeta) {
    return;
  }

  if (!pdfDocument) {
    readingMeta.textContent = bookMeta.title || DEFAULT_BOOK.title;
    return;
  }

  const { left, right } = getSpreadPageNumbers();
  const visibleLeft = Math.max(left, 1);
  const visibleRight = Math.min(right, totalPages);
  const range = visibleLeft === visibleRight ? `${visibleLeft}` : `${visibleLeft}-${visibleRight}`;
  const currentChapter = getCurrentChapterTitle(visibleLeft);
  readingMeta.textContent = `${range} / ${totalPages} | ${currentChapter}`;
}

async function renderPdfPage(pageNumber, pageEl, contentEl, sequence) {
  if (!pageEl || !contentEl) {
    return;
  }

  pageEl.classList.remove("page-is-error", "page-is-empty");

  if (!pdfDocument || pageNumber < 1 || pageNumber > totalPages) {
    pageEl.classList.add("page-is-empty");
    setMessage(contentEl, "", "pdf-empty-page");
    return;
  }

  setMessage(contentEl, "불러오는 중...", "pdf-page-message");

  try {
    const page = await pdfDocument.getPage(pageNumber);
    if (sequence !== renderSequence) {
      return;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const { width, height } = getRenderSize(contentEl);
    const fitScale = Math.min(width / baseViewport.width, height / baseViewport.height);
    const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);
    const renderScale = Math.max(0.1, fitScale * outputScale);
    const renderViewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new Error("canvas context unavailable");
    }

    canvas.className = "pdf-page-canvas";
    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));
    canvas.style.width = `${Math.max(1, baseViewport.width * fitScale).toFixed(2)}px`;
    canvas.style.height = `${Math.max(1, baseViewport.height * fitScale).toFixed(2)}px`;
    canvas.setAttribute("aria-label", `${pageNumber}쪽`);

    contentEl.replaceChildren(canvas);
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
  } catch (error) {
    if (sequence !== renderSequence) {
      return;
    }
    pageEl.classList.add("page-is-error");
    setMessage(contentEl, `${pageNumber}쪽을 불러오지 못했습니다.`);
  }
}

function renderShell() {
  const totalSpreads = getTotalSpreads();
  spreadIndex = clamp(spreadIndex, 0, totalSpreads - 1);

  const { left, right } = getSpreadPageNumbers();
  const sequence = renderSequence + 1;
  renderSequence = sequence;

  fitSpreadToViewport();
  setPageNumberLabels(left, right);
  updateMenuState();
  renderTocList();
  updateNavButtons();
  updateReadingMeta();

  void renderPdfPage(left, leftPage, leftContent, sequence);
  void renderPdfPage(right, rightPage, rightContent, sequence);
}

function renderFatalMessage(message) {
  pdfDocument = null;
  totalPages = 0;
  renderSequence += 1;
  fitSpreadToViewport();
  setMessage(leftContent, message);
  setMessage(rightContent, "", "pdf-empty-page");
  updateMenuState();
  renderTocList();
  updateNavButtons();
  updateReadingMeta();
}

function goToPage(pageNumber) {
  const safePage = clamp(parsePageNumber(pageNumber), 1, Math.max(totalPages, 1));
  spreadIndex = Math.floor(safePage / 2);
  renderShell();
}

function goPrev() {
  if (spreadIndex <= 0) {
    return;
  }
  spreadIndex -= 1;
  renderShell();
}

function goNext() {
  if (spreadIndex >= getTotalSpreads() - 1) {
    return;
  }
  spreadIndex += 1;
  renderShell();
}

function clearSettingsMenuScrollUnlockTimer() {
  if (settingsMenuScrollUnlockTimer) {
    window.clearTimeout(settingsMenuScrollUnlockTimer);
    settingsMenuScrollUnlockTimer = null;
  }
}

function setSettingsMenuScrollReady(isReady) {
  if (settingsMenu) {
    settingsMenu.classList.toggle("is-scroll-ready", isReady);
  }
}

function scheduleSettingsMenuScrollUnlock() {
  if (!settingsMenu) {
    return;
  }

  clearSettingsMenuScrollUnlockTimer();
  setSettingsMenuScrollReady(false);
  settingsMenuScrollUnlockTimer = window.setTimeout(() => {
    settingsMenuScrollUnlockTimer = null;
    if (showControls) {
      setSettingsMenuScrollReady(true);
    }
  }, SETTINGS_MENU_SCROLL_UNLOCK_MS);
}

function updateFullscreenButtonLabel() {
  if (!fullscreenBtn) {
    return;
  }

  const isFullscreen = !!document.fullscreenElement;
  if (fullscreenIcon) {
    fullscreenIcon.src = isFullscreen ? "./assets/shrinkicon.png" : "./assets/fullicon.png";
  }
  if (fullscreenLabel) {
    fullscreenLabel.textContent = isFullscreen ? "창 모드" : "전체화면";
  }
  fullscreenBtn.setAttribute("aria-label", isFullscreen ? "창 모드" : "전체화면");
  fullscreenBtn.title = isFullscreen ? "창 모드" : "전체화면";
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    // Fullscreen can be blocked by the browser or embedding context.
  } finally {
    updateFullscreenButtonLabel();
    renderShell();
  }
}

function bindEvents() {
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", toggleFullscreen);
  }

  if (homeBtn) {
    homeBtn.addEventListener("click", (event) => {
      const shouldLeave = window.confirm("정말 돌아가시겠습니까?");
      if (!shouldLeave) {
        event.preventDefault();
      }
    });
  }

  if (settingsTabBtn) {
    settingsTabBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showControls = !showControls;

      if (showControls) {
        scheduleSettingsMenuScrollUnlock();
      } else {
        clearSettingsMenuScrollUnlockTimer();
        showTocPanel = false;
      }

      renderShell();
    });
  }

  if (toggleTocBtn) {
    toggleTocBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      showControls = true;
      showTocPanel = !showTocPanel;
      scheduleSettingsMenuScrollUnlock();
      renderShell();
    });
  }

  if (controls) {
    controls.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", goPrev);
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", goNext);
  }
  if (leftPage) {
    leftPage.addEventListener("click", goPrev);
  }
  if (rightPage) {
    rightPage.addEventListener("click", goNext);
  }

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
    const isEditableTarget = !!(
      target &&
      (target.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        tagName === "button")
    );

    if (isEditableTarget) {
      return;
    }

    if (event.key === "ArrowLeft") {
      goPrev();
    } else if (event.key === "ArrowRight") {
      goNext();
    } else if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      goNext();
    }
  });

  document.addEventListener("click", () => {
    if (!showControls) {
      return;
    }
    clearSettingsMenuScrollUnlockTimer();
    setSettingsMenuScrollReady(false);
    showControls = false;
    showTocPanel = false;
    renderShell();
  });

  window.addEventListener(
    "resize",
    () => {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        renderShell();
      });
    },
    PASSIVE_POINTER_OPTIONS
  );

  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButtonLabel();
    renderShell();
  });

  window.addEventListener("beforeunload", clearSettingsMenuScrollUnlockTimer);
}

async function init() {
  bindEvents();
  fitSpreadToViewport();
  setMessage(leftContent, "PDF 불러오는 중...");
  setMessage(rightContent, "PDF 불러오는 중...");

  bookMeta = await loadBookMeta();
  setBookTitle(bookMeta.title);
  tocEntries = bookMeta.chapters.map((entry) => ({ ...entry }));
  updateFullscreenButtonLabel();
  updateReadingMeta();

  try {
    pdfDocument = await pdfjsLib.getDocument({ url: bookMeta.pdfUrl }).promise;
    totalPages = pdfDocument.numPages || 0;
    await syncSpreadAspectRatio();
    normalizeTocPages();
    renderShell();
  } catch (error) {
    renderFatalMessage(`${bookMeta.pdfUrl} 파일을 불러오지 못했습니다.`);
  }
}

init();
