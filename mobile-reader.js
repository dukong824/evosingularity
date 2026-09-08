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
const PAGE_SWIPE_THRESHOLD_PX = 44;
const PAGE_SWIPE_VERTICAL_LIMIT_PX = 72;
const PAGE_SWIPE_DOMINANCE_RATIO = 1.15;

const readerTitle = document.getElementById("mobileReaderTitle");
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

let bookMeta = { ...DEFAULT_BOOK };
let pdfDocument = null;
let totalPages = 0;
let currentPageNumber = 1;
let tocEntries = DEFAULT_BOOK.chapters.map((entry) => ({ ...entry }));
let activeTocIndex = 0;
let renderSequence = 0;
let resizeRaf = 0;

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
      throw new Error("book.json fetch failed");
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

function setTitle(title) {
  const safeTitle = clampText(title || DEFAULT_BOOK.title) || DEFAULT_BOOK.title;
  document.title = `${safeTitle} | 모바일 리더`;
  if (readerTitle) {
    readerTitle.textContent = safeTitle;
  }
}

function setMessage(message, className = "reader-loading") {
  if (!readerPageContent) {
    return;
  }

  const messageElement = document.createElement("p");
  messageElement.className = className;
  messageElement.textContent = message;
  readerPageContent.replaceChildren(messageElement);
}

function normalizeTocPages() {
  const maxPage = Math.max(totalPages, 1);
  tocEntries = bookMeta.chapters.map((entry) => ({
    title: entry.title,
    page: clamp(parsePageNumber(entry.page), 1, maxPage)
  }));
}

function updateNavButtons() {
  if (prevPageBtn) {
    prevPageBtn.disabled = !pdfDocument || currentPageNumber <= 1;
  }
  if (nextPageBtn) {
    nextPageBtn.disabled = !pdfDocument || currentPageNumber >= totalPages;
  }
}

function setPanelState(panel, trigger, isOpen) {
  if (!panel || !trigger) {
    return;
  }

  panel.classList.toggle("is-open", isOpen);
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function closeTocPanel() {
  setPanelState(tocPanel, toggleTocBtn, false);
}

function toggleTocPanel() {
  if (!tocPanel || !toggleTocBtn) {
    return;
  }

  const willOpen = !tocPanel.classList.contains("is-open");
  setPanelState(tocPanel, toggleTocBtn, willOpen);
}

function closeQuickMenu() {
  if (!menuSheet || !settingsBtn) {
    return;
  }

  closeTocPanel();
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
  menuSheet.classList.remove("hidden");
  menuSheet.setAttribute("aria-hidden", "false");
  settingsBtn.setAttribute("aria-expanded", "true");
}

function syncActiveTocIndexToCurrentPage() {
  let nextIndex = 0;
  for (let index = 0; index < tocEntries.length; index += 1) {
    const entry = tocEntries[index];
    const nextEntry = tocEntries[index + 1];
    if (currentPageNumber >= entry.page) {
      nextIndex = index;
    }
    if (!nextEntry || currentPageNumber < nextEntry.page) {
      break;
    }
  }

  activeTocIndex = nextIndex;
}

function updateTocActiveState() {
  if (!tocList) {
    return;
  }

  tocList.querySelectorAll(".menu-sheet-toc-item").forEach((item, index) => {
    const isActive = index === activeTocIndex;
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-current", isActive ? "true" : "false");
  });
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

  tocEntries.forEach((entry) => {
    const button = document.createElement("button");
    const title = document.createElement("span");
    const page = document.createElement("span");

    button.type = "button";
    button.className = "menu-sheet-toc-item";
    title.className = "menu-sheet-toc-title";
    page.className = "menu-sheet-toc-page";
    title.textContent = entry.title;
    page.textContent = `${entry.page}쪽`;
    button.append(title, page);
    button.addEventListener("click", () => {
      goToPage(entry.page);
      closeQuickMenu();
    });
    tocList.appendChild(button);
  });

  updateTocActiveState();
}

function getRenderSize() {
  if (!readerPageContent) {
    return { width: 0, height: 0 };
  }

  const rect = readerPageContent.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

async function renderCurrentPage() {
  if (!readerPage || !readerPageContent) {
    return;
  }

  renderSequence += 1;
  const sequence = renderSequence;
  currentPageNumber = clamp(currentPageNumber, 1, Math.max(totalPages, 1));
  readerPage.classList.remove("is-error");

  if (!pdfDocument) {
    setMessage(`${bookMeta.pdfUrl} 파일을 불러오지 못했습니다.`, "reader-error");
    updateNavButtons();
    return;
  }

  setMessage("불러오는 중...");

  try {
    const page = await pdfDocument.getPage(currentPageNumber);
    if (sequence !== renderSequence) {
      return;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const { width, height } = getRenderSize();
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
    canvas.setAttribute("aria-label", `${currentPageNumber}쪽`);

    readerPageContent.replaceChildren(canvas);
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    syncActiveTocIndexToCurrentPage();
    updateTocActiveState();
    updateNavButtons();
  } catch (error) {
    if (sequence !== renderSequence) {
      return;
    }
    readerPage.classList.add("is-error");
    setMessage(`${currentPageNumber}쪽을 불러오지 못했습니다.`, "reader-error");
    updateNavButtons();
  }
}

function goToPage(pageNumber) {
  currentPageNumber = clamp(parsePageNumber(pageNumber), 1, Math.max(totalPages, 1));
  void renderCurrentPage();
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
      if (event.touches.length !== 1 || (menuSheet && !menuSheet.classList.contains("hidden"))) {
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

      if (
        absDeltaX < PAGE_SWIPE_THRESHOLD_PX ||
        absDeltaY > PAGE_SWIPE_VERTICAL_LIMIT_PX ||
        absDeltaX <= absDeltaY * PAGE_SWIPE_DOMINANCE_RATIO
      ) {
        return;
      }

      goToPage(deltaX < 0 ? currentPageNumber + 1 : currentPageNumber - 1);
    },
    { passive: true }
  );
}

function bindEvents() {
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
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      goToPage(currentPageNumber - 1);
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      goToPage(currentPageNumber + 1);
    });
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
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeQuickMenu();
      return;
    }

    if (event.key === "ArrowLeft") {
      goToPage(currentPageNumber - 1);
      return;
    }

    if (event.key === "ArrowRight" || event.code === "Space" || event.key === " ") {
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
      }
      goToPage(currentPageNumber + 1);
    }
  });

  window.addEventListener("resize", () => {
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
    }
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      void renderCurrentPage();
    });
  });
}

async function initMobileReader() {
  bindEvents();
  setMessage("PDF 불러오는 중...");
  updateNavButtons();

  bookMeta = await loadBookMeta();
  setTitle(bookMeta.title);
  tocEntries = bookMeta.chapters.map((entry) => ({ ...entry }));
  renderTocList();

  try {
    pdfDocument = await pdfjsLib.getDocument({ url: bookMeta.pdfUrl }).promise;
    totalPages = pdfDocument.numPages || 0;
    normalizeTocPages();
    syncActiveTocIndexToCurrentPage();
    renderTocList();
    await renderCurrentPage();
  } catch (error) {
    pdfDocument = null;
    totalPages = 0;
    renderTocList();
    setMessage(`${bookMeta.pdfUrl} 파일을 불러오지 못했습니다.`, "reader-error");
    updateNavButtons();
  }
}

initMobileReader();
