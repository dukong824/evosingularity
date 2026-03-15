const FALLBACK_BOOK = {
  tocTitle: "샘플 챕터",
  content: [
    { type: "text", text: "JSON 파일을 불러오지 못해서 기본 텍스트를 표시합니다." },
    { type: "text", text: "book.json 파일을 프로젝트 루트에 두면 자동으로 읽어서 페이지를 계산합니다." }
  ]
};

let sourceBlocks = [];
let pages = [];
let spreadIndex = 0;
let fontSize = 15;
let lineHeight = 1.7;
let pageTone = "white";
let pagePadY = 60;
let pagePadX = 60;
let tocTitle = "목차 제목";
let coverImageSrc = "";
let spineImageSrc = "";
let showControls = false;
let showSettingsActions = false;
let introClosed = true;
let introFading = false;
let introFadeOut = false;
let measureEl = null;
let paginationSafetyBoostPx = 0;
let modeSettingProfiles = {
  windowed: null,
  fullscreen: null
};
const imageMeta = new Map();
const MAX_PAGINATION_STABILIZE_PASSES = 8;
const OVERFLOW_EPSILON_PX = 0.5;
const PAGINATION_BASE_SAFETY_RATIO = 0.14;
const PAGINATION_MAX_SAFETY_BOOST_PX = 14;

const controls = document.getElementById("controls");
const settingsTabBtn = document.getElementById("settingsTabBtn");
const settingsActions = document.getElementById("settingsActions");
const readerShell = document.getElementById("readerShell");
const spreadWrap = document.querySelector(".spread-wrap");
const spreadFrame = document.querySelector(".spread-frame");
const spread = document.querySelector(".spread");
const bookIntro = document.getElementById("bookIntro");
const book3dStage = document.getElementById("book3dStage");
const leftPage = document.getElementById("leftPage");
const rightPage = document.getElementById("rightPage");
const leftContent = document.getElementById("leftContent");
const rightContent = document.getElementById("rightContent");
const leftPageNumber = document.getElementById("leftPageNumber");
const rightPageNumber = document.getElementById("rightPageNumber");
const readingMeta = document.getElementById("readingMeta");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const startReadingBtn = document.getElementById("startReadingBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
const fullscreenIcon = document.getElementById("fullscreenIcon");
const fontSizeInput = document.getElementById("fontSize");
const lineHeightInput = document.getElementById("lineHeight");
const pagePadYInput = document.getElementById("pagePadY");
const pagePadXInput = document.getElementById("pagePadX");
const pageToneSelect = document.getElementById("pageToneSelect");
const pageToneTrigger = document.getElementById("pageToneTrigger");
const pageToneTriggerText = document.getElementById("pageToneTriggerText");
const pageToneOptions = document.getElementById("pageToneOptions");
const pageToneOptionButtons = Array.from(document.querySelectorAll(".custom-select-option[data-value]"));
const fontSizeValue = document.getElementById("fontSizeValue");
const lineHeightValue = document.getElementById("lineHeightValue");
const pagePadYValue = document.getElementById("pagePadYValue");
const pagePadXValue = document.getElementById("pagePadXValue");

if (!bookIntro || !book3dStage) {
  introClosed = false;
}

const PAGE_TONE_MAP = {
  default: "#fffdfa",
  warm: "#f8f1e3",
  white: "#ffffff"
};
const PAGE_TONE_LABEL_MAP = {
  default: "아이보리",
  warm: "베이지",
  white: "화이트"
};
const FULLSCREEN_PROFILE_BOOST = {
  fontSize: 3,
  pagePadY: 10,
  pagePadX: 10
};

let intro3d = null;
const INTRO_EXIT_MS = 1050;
const INTRO_FADE_START_RATIO = 0.82;
const INTRO_PREMOVE_RATIO = 0.26;

function viewportWidth() {
  return Math.max(window.innerWidth || document.documentElement.clientWidth || 1, 1);
}

function viewportHeight() {
  return Math.max(window.innerHeight || document.documentElement.clientHeight || 1, 1);
}

function toVw(value) {
  return `${(Number(value) / viewportWidth() * 100).toFixed(4)}vw`;
}

function toVh(value) {
  return `${(Number(value) / viewportHeight() * 100).toFixed(4)}vh`;
}

function toVmin(value) {
  const basis = Math.max(Math.min(viewportWidth(), viewportHeight()), 1);
  return `${(Number(value) / basis * 100).toFixed(4)}vmin`;
}

function toPxInt(value) {
  return `${Math.round(Number(value))}px`;
}

function updateRangeFill(input) {
  if (!input) {
    return;
  }
  const min = Number(input.min ?? 0);
  const max = Number(input.max ?? 100);
  const value = Number(input.value ?? min);
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  input.style.setProperty("--range-fill", `${(clamped * 100).toFixed(2)}%`);
}

function clampToInputRange(value, input) {
  const min = Number(input?.min ?? value);
  const max = Number(input?.max ?? value);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return Number(value);
  }
  return Math.max(min, Math.min(max, Number(value)));
}

function syncControlInputValues() {
  if (fontSizeInput) {
    fontSizeInput.value = String(fontSize);
  }
  if (lineHeightInput) {
    lineHeightInput.value = String(lineHeight);
  }
  if (pagePadYInput) {
    pagePadYInput.value = String(pagePadY);
  }
  if (pagePadXInput) {
    pagePadXInput.value = String(pagePadX);
  }
}

function buildProfileFromCurrent() {
  return {
    fontSize: clampToInputRange(fontSize, fontSizeInput),
    lineHeight: clampToInputRange(lineHeight, lineHeightInput),
    pagePadY: clampToInputRange(pagePadY, pagePadYInput),
    pagePadX: clampToInputRange(pagePadX, pagePadXInput),
    pageTone: pageTone in PAGE_TONE_MAP ? pageTone : "white"
  };
}

function getCurrentModeKey() {
  return document.fullscreenElement ? "fullscreen" : "windowed";
}

function persistCurrentModeProfile() {
  modeSettingProfiles[getCurrentModeKey()] = buildProfileFromCurrent();
}

function ensureFullscreenProfile() {
  if (modeSettingProfiles.fullscreen) {
    return;
  }
  const source = modeSettingProfiles.windowed || buildProfileFromCurrent();
  modeSettingProfiles.fullscreen = {
    fontSize: clampToInputRange(Number(source.fontSize) + FULLSCREEN_PROFILE_BOOST.fontSize, fontSizeInput),
    lineHeight: clampToInputRange(source.lineHeight, lineHeightInput),
    pagePadY: clampToInputRange(Number(source.pagePadY) + FULLSCREEN_PROFILE_BOOST.pagePadY, pagePadYInput),
    pagePadX: clampToInputRange(Number(source.pagePadX) + FULLSCREEN_PROFILE_BOOST.pagePadX, pagePadXInput),
    pageTone: source.pageTone in PAGE_TONE_MAP ? source.pageTone : "white"
  };
}

function applyModeProfile(modeKey) {
  if (modeKey === "fullscreen") {
    ensureFullscreenProfile();
  }

  const profile = modeSettingProfiles[modeKey] || modeSettingProfiles.windowed || buildProfileFromCurrent();
  fontSize = clampToInputRange(profile.fontSize, fontSizeInput);
  lineHeight = clampToInputRange(profile.lineHeight, lineHeightInput);
  pagePadY = clampToInputRange(profile.pagePadY, pagePadYInput);
  pagePadX = clampToInputRange(profile.pagePadX, pagePadXInput);
  pageTone = profile.pageTone in PAGE_TONE_MAP ? profile.pageTone : "white";
  syncControlInputValues();
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

function syncPageToneControl() {
  if (!pageToneTriggerText || !pageToneOptionButtons.length) {
    return;
  }
  if (!(pageTone in PAGE_TONE_MAP)) {
    pageTone = "white";
  }
  pageToneTriggerText.textContent = PAGE_TONE_LABEL_MAP[pageTone] || PAGE_TONE_LABEL_MAP.white;
  pageToneOptionButtons.forEach((button) => {
    const isSelected = button.dataset.value === pageTone;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function blockToHTML(block) {
  if (!block) {
    return "";
  }

  if (block.type === "chapter") {
    const title = escapeHTML(block.title || "").replace(/\n/g, "<br>").trim();
    if (!title) {
      return "";
    }
    return `<div class="chapter-break"><h2 class="chapter-title">${title}</h2></div>`;
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
    const alt = escapeHTML(block.alt || "");
    const src = escapeHTML(safeSrc);
    const caption = block.caption ? `<figcaption>${escapeHTML(block.caption)}</figcaption>` : "";
    const kindClass = block.mode === "full" ? "media-full" : "media-inline";
    return `<figure class="media-block ${kindClass}"><img src="${src}" alt="${alt}" loading="lazy" />${caption}</figure>`;
  }

  return "";
}

function blocksToHTML(blocks) {
  if (!blocks || blocks.length === 0) {
    return "<p class=\"paragraph empty-text\">내용이 없는 페이지입니다.</p>";
  }
  return blocks.map(blockToHTML).join("");
}

function ensureMeasureElement() {
  if (measureEl) {
    return measureEl;
  }

  measureEl = document.createElement("div");
  measureEl.className = "page-content";
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

function setPageContentStyle(target, pageHeight) {
  target.style.fontSize = toVmin(fontSize);
  target.style.lineHeight = String(lineHeight);
  target.style.setProperty("--page-h", `${Math.max(0, Number(pageHeight)).toFixed(2)}px`);
}

function getElementInnerSize(el) {
  if (!el) {
    return { width: 0, height: 0 };
  }
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  const padRight = Number.parseFloat(style.paddingRight) || 0;
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const padBottom = Number.parseFloat(style.paddingBottom) || 0;
  const width = Math.max(0, rect.width - padLeft - padRight);
  const height = Math.max(0, rect.height - padTop - padBottom);
  return { width, height };
}

function fitSpreadToViewport() {
  if (!spreadWrap || !spread || window.matchMedia("(max-aspect-ratio: 43/40)").matches) {
    spread.style.width = "";
    spread.style.height = "";
    return;
  }

  const ratio = 1.41421356;
  const wrapStyle = window.getComputedStyle(spreadWrap);
  const wrapPadLeft = Number.parseFloat(wrapStyle.paddingLeft) || 0;
  const wrapPadRight = Number.parseFloat(wrapStyle.paddingRight) || 0;
  const wrapPadTop = Number.parseFloat(wrapStyle.paddingTop) || 0;
  const wrapPadBottom = Number.parseFloat(wrapStyle.paddingBottom) || 0;
  const frameStyle = spreadFrame ? window.getComputedStyle(spreadFrame) : null;
  const framePadBottom = frameStyle ? (Number.parseFloat(frameStyle.paddingBottom) || 0) : 0;
  const availableWidth = Math.max(0, spreadWrap.clientWidth - wrapPadLeft - wrapPadRight);
  const availableHeight = Math.max(0, spreadWrap.clientHeight - wrapPadTop - wrapPadBottom - framePadBottom);

  let width = Math.max(0, availableWidth);
  let height = width / ratio;

  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }

  spread.style.width = toVw(Math.floor(width));
  spread.style.height = toVh(Math.floor(height));
}

function createBookCuboidA5(THREE) {
  const group = new THREE.Group();

  // A5 front ratio: 148 x 210 => 1 : 1.4189
  const width = 2.1;
  const height = width * (210 / 148);
  const blockThickness = 0.34;
  const coverThickness = 0.04;

  const edgeGray = 0xf5f5f5;

  const faceBack = new THREE.MeshStandardMaterial({
    color: edgeGray,
    metalness: 0.0,
    roughness: 0.86,
    emissive: 0x000000,
    emissiveIntensity: 0.0
  });
  const facePages = new THREE.MeshStandardMaterial({
    color: 0xf8f8f8,
    metalness: 0.0,
    roughness: 0.82,
    emissive: 0x111111,
    emissiveIntensity: 0.01
  });
  const faceTop = new THREE.MeshStandardMaterial({
    color: 0xd2d2d2,
    metalness: 0.0,
    roughness: 0.98,
    emissive: 0x000000,
    emissiveIntensity: 0.0
  });
  const faceBottom = new THREE.MeshStandardMaterial({
    color: 0xe6e6e6,
    metalness: 0.0,
    roughness: 0.9,
    emissive: 0x000000,
    emissiveIntensity: 0.0
  });
  const faceSpine = new THREE.MeshStandardMaterial({
    color: 0xf4f4f4,
    metalness: 0.0,
    roughness: 0.92,
    emissive: 0x000000,
    emissiveIntensity: 0.0
  });

  const pagesFront = new THREE.MeshStandardMaterial({
    color: 0xf8f8f8,
    metalness: 0.0,
    roughness: 0.8,
    emissive: 0x1a1a1a,
    emissiveIntensity: 0.03
  });

  // page block order: +X, -X, +Y, -Y, +Z, -Z
  const pageBlockMaterials = [
    facePages, // right edge
    faceSpine, // left edge (spine)
    faceTop, // top edge
    faceBottom, // bottom edge
    pagesFront, // page face (front)
    faceBack  // back cover
  ];

  const pageBlock = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, blockThickness),
    pageBlockMaterials
  );
  group.add(pageBlock);

  const coverFront = new THREE.MeshStandardMaterial({
    color: 0x5f5f5f,
    metalness: 0.01,
    roughness: 0.88,
    emissive: 0x111111,
    emissiveIntensity: 0.01
  });
  const coverInside = new THREE.MeshStandardMaterial({
    color: 0xf7f7f7,
    metalness: 0.0,
    roughness: 0.88,
    emissive: 0xffffff,
    emissiveIntensity: 0.015
  });
  const coverSpine = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.0,
    roughness: 0.9,
    emissive: 0x000000,
    emissiveIntensity: 0.0
  });
  const coverEdge = new THREE.MeshStandardMaterial({
    color: 0xe5e5e5,
    metalness: 0.0,
    roughness: 0.9,
    emissive: 0x111111,
    emissiveIntensity: 0.0
  });

  const frontCover = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, coverThickness),
    [
      coverEdge, // +X right edge
      coverSpine, // -X spine edge
      coverEdge,
      coverEdge,
      coverFront, // outer cover
      coverInside // inner cover
    ]
  );

  const hinge = new THREE.Group();
  // Keep cover-body gap minimal while still avoiding seam fighting.
  const hingeAxisOffsetX = 0.001;
  hinge.position.set(-width / 2 - hingeAxisOffsetX, 0, blockThickness / 2 + coverThickness / 2 + 0.0008);
  frontCover.position.set(width / 2 + hingeAxisOffsetX, 0, 0);
  hinge.add(frontCover);
  group.add(hinge);

  if (coverImageSrc) {
    const loader = new THREE.TextureLoader();
    loader.load(
      coverImageSrc,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = 4;
        coverFront.map = texture;
        coverFront.color.set(0xffffff);
        coverFront.needsUpdate = true;
      },
      undefined,
      () => {}
    );
  }

  if (spineImageSrc) {
    const spineLoader = new THREE.TextureLoader();
    spineLoader.load(
      spineImageSrc,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = 4;
        // Apply spine texture to the page-block spine only.
        faceSpine.map = texture;
        faceSpine.color.set(0xffffff);
        faceSpine.needsUpdate = true;
      },
      undefined,
      () => {}
    );
  }

  group.setOpenAmount = (amount) => {
    const clamped = Math.min(1, Math.max(0, amount));
    const insideBoost = clamped * clamped;
    coverInside.emissiveIntensity = 0.02 + (0.12 - 0.02) * insideBoost;
    pagesFront.emissiveIntensity = 0.03 + (0.16 - 0.03) * insideBoost;
    // Avoid exact 180deg to reduce hinge seam artifacts.
    const maxOpenAngle = Math.PI * 0.985;
    hinge.rotation.y = -maxOpenAngle * clamped;
  };
  group.setOpenAmount(0);

  return group;
}

function initIntro3D() {
  if (!book3dStage || !window.THREE) {
    return;
  }

  const THREE = window.THREE;
  const stageRect = book3dStage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(stageRect.width));
  const height = Math.max(1, Math.floor(stageRect.height));

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
  camera.position.set(0, 0, 9.6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0xffffff, 1);
  book3dStage.innerHTML = "";
  book3dStage.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d9d9, 1.32);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.24);
  key.position.set(4, 7, 4);
  scene.add(key);

  const keySpine = new THREE.DirectionalLight(0xffffff, 0.9);
  keySpine.position.set(-4, 6, 4);
  scene.add(keySpine);

  const rim = new THREE.DirectionalLight(0xd6d6d6, 0.34);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  const fill = new THREE.DirectionalLight(0xffffff, 0.84);
  fill.position.set(0, -6, 5);
  scene.add(fill);

  const root = new THREE.Group();
  root.rotation.set(0, 0, 0);
  scene.add(root);

  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const basePitch = 0.1;
  const cameraBaseZ = 9.6;
  const cameraExitZ = 8.35;
  const baseScale = 1.45;
  const exitScale = baseScale;
  const introBookHalfWidthX = (2.1 * baseScale) / 2;
  const introBookHalfHeightY = (2.1 * (210 / 148) * baseScale) / 2;
  const interactionHalfX = introBookHalfWidthX * 1.05;
  const interactionHalfY = introBookHalfHeightY * 1.05;
  const exitTravelX = introBookHalfWidthX * 2;
  const introStaticShiftX = 0;
  let rootBaseX = introStaticShiftX;
  let rootExitX = rootBaseX + exitTravelX;
  let object3d = null;
  const pointerNear = new THREE.Vector3();
  const pointerDir = new THREE.Vector3();
  const pointerWorld = new THREE.Vector3();

  const applyPointer = (event) => {
    const rect = book3dStage.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const ndcX = ((event.clientX - rect.left) / w) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / h) * 2 - 1);

    pointerNear.set(ndcX, ndcY, 0.5).unproject(camera);
    pointerDir.copy(pointerNear).sub(camera.position);
    if (Math.abs(pointerDir.z) < 1e-6) {
      return;
    }

    const t = -camera.position.z / pointerDir.z;
    if (!Number.isFinite(t)) {
      return;
    }
    pointerWorld.copy(camera.position).addScaledVector(pointerDir, t);

    const localX = pointerWorld.x - rootBaseX;
    const localY = pointerWorld.y;
    const nx = Math.max(-1, Math.min(1, localX / interactionHalfX));
    const ny = Math.max(-1, Math.min(1, localY / interactionHalfY));

    target.y = nx * 0.42;
    target.x = ny * 0.36;
  };

  const resetPointer = () => {
    target.x = 0;
    target.y = 0;
  };

  const handlePointerOut = (event) => {
    if (!event.relatedTarget) {
      resetPointer();
    }
  };

  window.addEventListener("pointermove", applyPointer);
  window.addEventListener("pointerout", handlePointerOut);
  window.addEventListener("blur", resetPointer);

  const animate = () => {
    if (!intro3d || !intro3d.active) {
      return;
    }

    if (intro3d.exiting) {
      const elapsed = performance.now() - intro3d.exitStart;
      const t = Math.min(1, elapsed / INTRO_EXIT_MS);
      const easeOverall = 1 - Math.pow(1 - t, 3);
      const movePhase = Math.min(1, t / INTRO_PREMOVE_RATIO);
      const openPhase = Math.max(0, Math.min(1, (t - INTRO_PREMOVE_RATIO) / (1 - INTRO_PREMOVE_RATIO)));
      const easeMove = 1 - Math.pow(1 - movePhase, 3);
      const easeOpen = 1 - Math.pow(1 - openPhase, 3);

      root.rotation.x = basePitch * (1 - easeMove);
      root.rotation.y = 0;
      root.rotation.z = 0;
      root.position.x = rootBaseX + (rootExitX - rootBaseX) * easeMove;

      const scale = baseScale + (exitScale - baseScale) * easeOverall;
      object3d.scale.set(scale, scale, scale);
      if (typeof object3d.setOpenAmount === "function") {
        object3d.setOpenAmount(easeOpen);
      }
      camera.position.z = cameraBaseZ + (cameraExitZ - cameraBaseZ) * easeOverall;
      camera.lookAt(0, 0, 0);
    } else {
      current.x += (target.x - current.x) * 0.16;
      current.y += (target.y - current.y) * 0.16;
      root.rotation.x = basePitch + current.x;
      root.rotation.y = current.y;
      root.rotation.z = 0;
      root.position.x = rootBaseX;
      object3d.scale.set(baseScale, baseScale, baseScale);
      if (typeof object3d.setOpenAmount === "function") {
        object3d.setOpenAmount(0);
      }
      camera.position.z = cameraBaseZ;
      camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
    intro3d.raf = requestAnimationFrame(animate);
  };

  const handleResize = () => {
    const rect = book3dStage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (!intro3d?.exiting) {
      root.position.x = rootBaseX;
    }
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(book3dStage);

  intro3d = {
    active: true,
    raf: null,
    exiting: false,
    exitStart: 0,
    cleanup: () => {
      intro3d.active = false;
      if (intro3d.raf) {
        cancelAnimationFrame(intro3d.raf);
      }
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", applyPointer);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", resetPointer);
      renderer.dispose();
    }
  };

  object3d = createBookCuboidA5(THREE);
  object3d.position.set(0, 0, 0);
  object3d.rotation.set(0, 0, 0);
  object3d.scale.set(baseScale, baseScale, baseScale);

  root.add(object3d);
  scene.updateMatrixWorld(true);
  const baseBox = new THREE.Box3().setFromObject(object3d);
  const baseCenter = new THREE.Vector3();
  baseBox.getCenter(baseCenter);

  // Center the model geometry itself first, then animate the parent group.
  object3d.position.x -= baseCenter.x;
  object3d.updateMatrixWorld(true);
  root.position.x = rootBaseX;
  animate();
}

function normalizeBookData(raw) {
  const result = {
    tocTitle: String(raw?.tocTitle || raw?.title || FALLBACK_BOOK.tocTitle).trim() || FALLBACK_BOOK.tocTitle,
    coverImage: sanitizeAssetURL(raw?.coverImage || raw?.cover || ""),
    spineImage: sanitizeAssetURL(raw?.spineImage || raw?.spine || ""),
    blocks: []
  };

  const fromString = (text) => ({ type: "text", text: String(text || "").trim() });

  let content = raw?.content;

  if (!Array.isArray(content)) {
    if (typeof content === "string") {
      content = content
        .split(/\n\s*\n/g)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => ({ type: "text", text: v }));
    } else if (Array.isArray(raw?.pages)) {
      content = raw.pages
        .map((p) => (typeof p === "string" ? p : p?.text || ""))
        .join("\n\n")
        .split(/\n\s*\n/g)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => ({ type: "text", text: v }));
    } else {
      content = FALLBACK_BOOK.content;
    }
  }

  for (const entry of content) {
    if (typeof entry === "string") {
      const block = fromString(entry);
      if (block.text) {
        result.blocks.push(block);
      }
      continue;
    }

    if (!entry || typeof entry !== "object") {
      continue;
    }

    if (typeof entry.chapterTitle === "string" && entry.chapterTitle.trim()) {
      result.blocks.push({ type: "chapter", title: entry.chapterTitle.trim() });
    }

    if (entry.type === "chapter" || entry.type === "section" || entry.type === "heading") {
      let headingText = String(entry.title ?? entry.heading ?? entry.chapter ?? "").trim();
      let chapterBody = entry.body ?? entry.content;
      if (!headingText && typeof entry.text === "string") {
        headingText = entry.text.trim();
      } else if (chapterBody == null && typeof entry.text === "string") {
        chapterBody = entry.text;
      }
      if (headingText) {
        result.blocks.push({ type: "chapter", title: headingText });
      }
      if (typeof chapterBody === "string" && chapterBody.trim()) {
        result.blocks.push({ type: "text", text: chapterBody.trim() });
      }
      continue;
    }

    if (entry.type === "quote" || entry.quote != null || entry.author != null) {
      const quoteText = entry.text ?? entry.quote ?? entry.content;
      const authorText = entry.author ?? entry.name ?? entry.person ?? entry.speaker;
      if (typeof quoteText === "string" && quoteText.trim()) {
        result.blocks.push({
          type: "quote",
          text: quoteText.trim(),
          author: typeof authorText === "string" ? authorText.trim() : ""
        });
      }
      continue;
    }

    if (entry.type === "image" && typeof entry.src === "string" && entry.src.trim()) {
      const safeSrc = sanitizeAssetURL(entry.src);
      if (!safeSrc) {
        continue;
      }
      result.blocks.push({
        type: "image",
        src: safeSrc,
        alt: String(entry.alt || ""),
        caption: String(entry.caption || "").trim(),
        mode: entry.mode === "full" ? "full" : "inline"
      });
      continue;
    }

    const textValue = entry.text ?? entry.content;
    if (typeof textValue === "string" && textValue.trim()) {
      result.blocks.push({ type: "text", text: textValue.trim() });
    }
  }

  if (result.blocks.length === 0) {
    result.blocks = FALLBACK_BOOK.content.map((b) => ({ ...b }));
  }

  return result;
}

function loadImageMeta(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 1600, height: img.naturalHeight || 900 });
    };
    img.onerror = () => {
      resolve({ width: 1600, height: 900 });
    };
    img.src = src;
  });
}

async function preloadImageMeta(blocks) {
  const imageBlocks = blocks.filter((b) => b.type === "image" && b.src);
  const unique = [...new Set(imageBlocks.map((b) => b.src))];

  const results = await Promise.all(
    unique.map(async (src) => {
      const meta = await loadImageMeta(src);
      return { src, meta };
    })
  );

  for (const item of results) {
    imageMeta.set(item.src, item.meta);
  }
}

async function loadBook() {
  try {
    const response = await fetch("./book.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const normalized = normalizeBookData(data);
    tocTitle = normalized.tocTitle;
    coverImageSrc = normalized.coverImage;
    spineImageSrc = normalized.spineImage;
    sourceBlocks = normalized.blocks;
  } catch (error) {
    tocTitle = FALLBACK_BOOK.tocTitle;
    coverImageSrc = "";
    spineImageSrc = "";
    sourceBlocks = FALLBACK_BOOK.content.map((b) => ({ ...b }));
  }

  await preloadImageMeta(sourceBlocks);
}

function pageFits(candidateBlocks, pageWidth, pageHeight) {
  const probe = ensureMeasureElement();
  probe.style.width = `${Math.max(0, Number(pageWidth)).toFixed(2)}px`;
  probe.style.height = "auto";
  setPageContentStyle(probe, pageHeight);
  probe.innerHTML = blocksToHTML(candidateBlocks);
  const computedLineHeight = Number.parseFloat(window.getComputedStyle(probe).lineHeight);
  const estimatedLinePx = Number.isFinite(computedLineHeight)
    ? computedLineHeight
    : Math.max(12, Number(fontSize) * Number(lineHeight));
  const baseSafetyPx = Math.max(1, Math.ceil(estimatedLinePx * PAGINATION_BASE_SAFETY_RATIO));
  const bottomSafetyPx = baseSafetyPx + paginationSafetyBoostPx;
  const measuredHeight = Math.max(probe.scrollHeight, probe.getBoundingClientRect().height);
  return measuredHeight <= Math.max(0, pageHeight - bottomSafetyPx);
}

function getContentOverflowPx(contentEl) {
  if (!contentEl) {
    return 0;
  }
  const overflowY = Math.max(0, contentEl.scrollHeight - contentEl.clientHeight);
  return overflowY;
}

function getCurrentSpreadOverflowPx(currentSpread) {
  const leftOverflow = getContentOverflowPx(leftContent);
  const rightOverflow = currentSpread?.hasRight ? getContentOverflowPx(rightContent) : 0;
  return Math.max(leftOverflow, rightOverflow);
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

function repaginate(anchorAbsolutePage = 0) {
  const innerSize = getElementInnerSize(leftContent);
  const pageWidth = innerSize.width;
  const pageHeight = innerSize.height;

  if (!pageWidth || !pageHeight) {
    return;
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
          ? pageFits([...pageBlocks, { type: "text", text: front }], pageWidth, pageHeight)
          : false;

        if (front && frontFits) {
          pageBlocks.push({ type: "text", text: front });
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

    if (pageBlocks.length === 0) {
      const forced = queue.shift();
      if (forced) {
        pageBlocks.push(forced);
      }
    }

    rebuilt.push({ blocks: pageBlocks });
  }

  pages = rebuilt.length > 0 ? rebuilt : [{ blocks: [{ type: "text", text: "내용이 없습니다." }] }];

  const totalSpreads = Math.max(1, Math.ceil(pages.length / 2));
  spreadIndex = Math.min(Math.floor(anchorAbsolutePage / 2), totalSpreads - 1);
}

function getSpreadPages(allPages, currentSpreadIndex) {
  const leftIndex = currentSpreadIndex * 2;
  const rightIndex = leftIndex + 1;

  return {
    left: allPages[leftIndex] || { blocks: [] },
    right: allPages[rightIndex] || { blocks: [] },
    hasRight: rightIndex < allPages.length
  };
}

function getCurrentChapterTitle(absolutePageIndex) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return tocTitle;
  }

  const safePageIndex = Math.max(0, Math.min(absolutePageIndex, pages.length - 1));
  let currentTitle = String(tocTitle || "").trim() || FALLBACK_BOOK.tocTitle;

  for (let i = 0; i <= safePageIndex; i += 1) {
    const page = pages[i];
    if (!page || !Array.isArray(page.blocks)) {
      continue;
    }
    for (const block of page.blocks) {
      if (block?.type === "chapter") {
        const title = String(block.title || "").trim();
        if (title) {
          currentTitle = title;
        }
      }
    }
  }

  return currentTitle;
}

function isFullImagePage(page) {
  return !!(page && page.blocks && page.blocks.length === 1 && page.blocks[0].type === "image" && page.blocks[0].mode === "full");
}

function renderPage(pageData, pageEl, contentEl, pageHeight) {
  const fullImage = isFullImagePage(pageData);
  pageEl.classList.toggle("page-has-full-image", fullImage);
  setPageContentStyle(contentEl, pageHeight);
  contentEl.innerHTML = blocksToHTML(pageData.blocks);
}

function render(stabilizePass = 0) {
  if (stabilizePass === 0) {
    paginationSafetyBoostPx = 0;
  }

  const totalPages = pages.length;
  const totalSpreads = Math.ceil(totalPages / 2);
  const currentSpread = getSpreadPages(pages, spreadIndex);

  const innerSize = getElementInnerSize(leftContent);
  const pageHeight = innerSize.height || 600;

  renderPage(currentSpread.left, leftPage, leftContent, pageHeight);

  if (currentSpread.hasRight) {
    renderPage(currentSpread.right, rightPage, rightContent, pageHeight);
  } else {
    rightPage.classList.remove("page-has-full-image");
    setPageContentStyle(rightContent, pageHeight);
    rightContent.innerHTML = "<p class=\"paragraph empty-text\">마지막 장입니다.</p>";
  }

  leftPageNumber.textContent = "";
  rightPageNumber.textContent = "";

  if (spreadFrame) {
    spreadFrame.classList.toggle("intro-closed", introClosed);
    spreadFrame.classList.toggle("intro-fading", introFading);
    spreadFrame.classList.toggle("intro-fadeout", introFadeOut);
  }
  document.body.classList.toggle("intro-3d-mode", introClosed || introFading);
  if (readerShell) {
    readerShell.classList.toggle("intro-3d-mode", introClosed || introFading);
  }
  if (bookIntro) {
    bookIntro.setAttribute("aria-hidden", introClosed ? "false" : "true");
  }

  prevBtn.disabled = introClosed || introFading || spreadIndex === 0;
  nextBtn.disabled = introFading || (!introClosed && spreadIndex >= totalSpreads - 1);
  controls.classList.toggle("hidden", !showControls);
  if (!showControls) {
    closePageToneOptions();
  }
  settingsActions.classList.toggle("is-open", showSettingsActions);
  settingsTabBtn.setAttribute("aria-expanded", showSettingsActions ? "true" : "false");
  syncPageToneControl();
  document.documentElement.style.setProperty("--paper", PAGE_TONE_MAP[pageTone] || PAGE_TONE_MAP.default);
  document.documentElement.style.setProperty("--page-pad-y", toVh(pagePadY));
  document.documentElement.style.setProperty("--page-pad-x", toVw(pagePadX));

  const visibleLastPageIndex = introClosed
    ? 0
    : Math.min(
      spreadIndex * 2 + (currentSpread.hasRight ? 1 : 0),
      Math.max(totalPages - 1, 0)
    );
  const progressSpreadIndex = (introClosed || spreadIndex === 0) ? 0 : Math.min(spreadIndex, Math.max(totalSpreads - 1, 0));
  const progressPercent = totalSpreads <= 1 ? 100 : Math.round((progressSpreadIndex / (totalSpreads - 1)) * 100);
  const chapterTitle = getCurrentChapterTitle(visibleLastPageIndex);
  readingMeta.textContent = `${progressPercent}% | ${chapterTitle}`;

  fontSizeValue.textContent = toPxInt(fontSize);
  lineHeightValue.textContent = lineHeight.toFixed(1);
  pagePadYValue.textContent = toPxInt(pagePadY);
  pagePadXValue.textContent = toPxInt(pagePadX);
  syncControlInputValues();
  updateRangeFill(fontSizeInput);
  updateRangeFill(lineHeightInput);
  updateRangeFill(pagePadYInput);
  updateRangeFill(pagePadXInput);

  if (!introClosed && !introFading && stabilizePass < MAX_PAGINATION_STABILIZE_PASSES) {
    const overflowPx = getCurrentSpreadOverflowPx(currentSpread);
    if (overflowPx > OVERFLOW_EPSILON_PX) {
      const boostStep = Math.max(1, Math.min(2, Math.ceil(overflowPx)));
      paginationSafetyBoostPx = Math.min(PAGINATION_MAX_SAFETY_BOOST_PX, paginationSafetyBoostPx + boostStep);
      repaginate(spreadIndex * 2);
      render(stabilizePass + 1);
    }
  }
}

function refreshLayoutAndRender(preservePosition = true) {
  const anchorAbsolutePage = preservePosition ? spreadIndex * 2 : 0;
  paginationSafetyBoostPx = 0;
  fitSpreadToViewport();
  repaginate(anchorAbsolutePage);
  render();
}

function stabilizeAndRepaginate() {
  const run = () => {
    if (!introFading) {
      refreshLayoutAndRender(true);
    }
  };

  run();
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
  window.setTimeout(run, 140);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(run);
  }
}

function goPrev() {
  if (introClosed) {
    return;
  }
  if (spreadIndex > 0) {
    spreadIndex -= 1;
    render();
  }
}

function openIntroBook() {
  if (!introClosed || introFading) {
    return;
  }
  introFading = true;
  introFadeOut = false;
  if (intro3d) {
    intro3d.exiting = true;
    intro3d.exitStart = performance.now();
  }
  render();
  window.setTimeout(() => {
    introFadeOut = true;
    render();
  }, Math.floor(INTRO_EXIT_MS * INTRO_FADE_START_RATIO));
  window.setTimeout(() => {
    if (intro3d?.cleanup) {
      intro3d.cleanup();
      intro3d = null;
    }
    introClosed = false;
    introFading = false;
    introFadeOut = false;
    stabilizeAndRepaginate();
  }, INTRO_EXIT_MS);
}

function goNext() {
  if (introClosed) {
    openIntroBook();
    return;
  }
  const totalSpreads = Math.ceil(pages.length / 2);
  if (spreadIndex < totalSpreads - 1) {
    spreadIndex += 1;
    render();
  }
}

function updateFullscreenButtonLabel() {
  const isFullscreen = !!document.fullscreenElement;
  if (fullscreenIcon) {
    fullscreenIcon.src = isFullscreen ? "./assets/shrinkicon.png" : "./assets/fullicon.png";
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
    // Fullscreen may fail on unsupported browsers or blocked contexts.
  } finally {
    updateFullscreenButtonLabel();
  }
}

fullscreenBtn.addEventListener("click", toggleFullscreen);

settingsTabBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  showSettingsActions = !showSettingsActions;
  if (!showSettingsActions) {
    showControls = false;
  }
  render();
});

toggleSettingsBtn.addEventListener("click", () => {
  showSettingsActions = true;
  showControls = !showControls;
  render();
});

controls.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!e.target.closest("#pageToneSelect")) {
    closePageToneOptions();
  }
});

settingsActions.addEventListener("click", (e) => {
  e.stopPropagation();
  closePageToneOptions();
});

if (pageToneTrigger) {
  pageToneTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePageToneOptions();
  });
}

if (pageToneOptions) {
  pageToneOptions.addEventListener("click", (e) => {
    e.stopPropagation();
    const toneButton = e.target.closest(".custom-select-option[data-value]");
    if (!toneButton) {
      return;
    }
    pageTone = toneButton.dataset.value || "white";
    persistCurrentModeProfile();
    closePageToneOptions();
    render();
  });
}

prevBtn.addEventListener("click", goPrev);
nextBtn.addEventListener("click", goNext);
leftPage.addEventListener("click", goPrev);
rightPage.addEventListener("click", goNext);
if (startReadingBtn) {
  startReadingBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openIntroBook();
  });
}

fontSizeInput.addEventListener("input", (e) => {
  fontSize = Number(e.target.value);
  persistCurrentModeProfile();
  refreshLayoutAndRender(true);
});

lineHeightInput.addEventListener("input", (e) => {
  lineHeight = Number(e.target.value);
  persistCurrentModeProfile();
  refreshLayoutAndRender(true);
});

pagePadYInput.addEventListener("input", (e) => {
  pagePadY = Number(e.target.value);
  persistCurrentModeProfile();
  refreshLayoutAndRender(true);
});

pagePadXInput.addEventListener("input", (e) => {
  pagePadX = Number(e.target.value);
  persistCurrentModeProfile();
  refreshLayoutAndRender(true);
});

document.addEventListener("keydown", (e) => {
  const target = e.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
  const isEditableTarget = !!(
    target &&
    (
      target.isContentEditable ||
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      tagName === "button"
    )
  );

  if (isEditableTarget) {
    return;
  }

  if (e.key === "ArrowLeft") {
    goPrev();
  }
  if (e.key === "ArrowRight") {
    goNext();
  }
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    goNext();
  }
});

let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    refreshLayoutAndRender(true);
  });
});

document.addEventListener("fullscreenchange", () => {
  updateFullscreenButtonLabel();
  applyModeProfile(document.fullscreenElement ? "fullscreen" : "windowed");
  refreshLayoutAndRender(true);
});

document.addEventListener("click", () => {
  closePageToneOptions();
  if (showSettingsActions || showControls) {
    showSettingsActions = false;
    showControls = false;
    render();
  }
});

window.addEventListener("beforeunload", () => {
  if (intro3d?.cleanup) {
    intro3d.cleanup();
  }
});

(async function init() {
  await loadBook();
  modeSettingProfiles.windowed = buildProfileFromCurrent();
  initIntro3D();
  updateFullscreenButtonLabel();
  refreshLayoutAndRender(false);
})();

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    refreshLayoutAndRender(true);
  });
  if (typeof document.fonts.addEventListener === "function") {
    document.fonts.addEventListener("loadingdone", () => {
      refreshLayoutAndRender(true);
    });
  }
}
