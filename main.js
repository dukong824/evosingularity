const book3dStage = document.getElementById("book3dStage");
const startReadingBtn = document.getElementById("startReadingBtn");
const homeActions = document.querySelector(".home-actions");

const INTRO_EXIT_MS = 1050;
const INTRO_MOVE_ONLY_RATIO = 0.52;
const READER_URL = "./reader.html";

let coverImageSrc = "";
let spineImageSrc = "";
let home3d = null;

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

async function loadBookMeta() {
  try {
    const response = await fetch("./book.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    coverImageSrc = sanitizeAssetURL(data?.coverImage || data?.cover || "");
    spineImageSrc = sanitizeAssetURL(data?.spineImage || data?.spine || "");
  } catch (error) {
    coverImageSrc = "";
    spineImageSrc = "";
  }
}

function createBookCuboidA5(THREE) {
  const group = new THREE.Group();

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

  const pageBlock = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, blockThickness),
    [facePages, faceSpine, faceTop, faceBottom, pagesFront, faceBack]
  );
  group.add(pageBlock);

  const coverFront = new THREE.MeshStandardMaterial({
    color: 0x787878,
    metalness: 0.01,
    roughness: 0.88,
    emissive: 0x111111,
    emissiveIntensity: 0.03
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
    [coverEdge, coverSpine, coverEdge, coverEdge, coverFront, coverInside]
  );

  const hinge = new THREE.Group();
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
    const maxOpenAngle = Math.PI * 0.985;
    hinge.rotation.y = -maxOpenAngle * clamped;
  };
  group.setOpenAmount(0);

  return group;
}

function initHome3D() {
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9d9, 1.58));
  const key = new THREE.DirectionalLight(0xffffff, 1.48);
  key.position.set(4, 7, 4);
  scene.add(key);
  const keySpine = new THREE.DirectionalLight(0xffffff, 1.12);
  keySpine.position.set(-4, 6, 4);
  scene.add(keySpine);
  const rim = new THREE.DirectionalLight(0xe0e0e0, 0.5);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 1.06);
  fill.position.set(0, -6, 5);
  scene.add(fill);

  const root = new THREE.Group();
  scene.add(root);

  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const basePitch = 0;
  const cameraBaseZ = 9.6;
  const cameraExitZ = 8.35;
  const baseScaleBase = 1.44;
  const leftShiftVw = 5;
  const rightCompensationRatio = 0.5;
  const extraRightTravelVw = 2.5;
  let baseScale = baseScaleBase;
  let introBookHalfWidthX = (2.1 * baseScale) / 2;
  let introBookHalfHeightY = (2.1 * (210 / 148) * baseScale) / 2;
  let rootBaseX = -introBookHalfWidthX * 1.15;
  const rootBaseY = 0;
  const toWorldXAtBookPlane = (pixels, stageW, stageH) => {
    const safeW = Math.max(1, stageW);
    const safeH = Math.max(1, stageH);
    const fovRad = 34 * Math.PI / 180;
    const visibleHeight = 2 * Math.tan(fovRad / 2) * cameraBaseZ;
    const visibleWidth = visibleHeight * (safeW / safeH);
    return pixels * (visibleWidth / safeW);
  };
  const viewportCompensationPx = () =>
    window.innerWidth * ((leftShiftVw * rightCompensationRatio + extraRightTravelVw) / 100);
  let rootExitX = introBookHalfWidthX * 1.02 + toWorldXAtBookPlane(viewportCompensationPx(), width, height);
  let object3d = null;

  const updateBookLayout = (stageW, stageH) => {
    baseScale = baseScaleBase;
    introBookHalfWidthX = (2.1 * baseScale) / 2;
    introBookHalfHeightY = (2.1 * (210 / 148) * baseScale) / 2;
    rootBaseX = -introBookHalfWidthX * 1.15;
    rootExitX = introBookHalfWidthX * 1.02 + toWorldXAtBookPlane(viewportCompensationPx(), stageW, stageH);

    if (object3d) {
      object3d.scale.set(baseScale, baseScale, baseScale);
    }

    root.position.set(rootBaseX, rootBaseY, 0);
  };

  const applyPointer = (event) => {
    const rect = book3dStage.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    const nx = (event.clientX - rect.left) / w * 2 - 1;
    const ny = -((event.clientY - rect.top) / h * 2 - 1);

    const fovRad = 34 * Math.PI / 180;
    const visibleWidth = 2 * Math.tan(fovRad / 2) * 9.6;
    const bookOffsetNdc = rootBaseX / (visibleWidth / 2);

    target.y = (nx - bookOffsetNdc) * 0.42;
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

  object3d = createBookCuboidA5(THREE);
  object3d.scale.set(baseScale, baseScale, baseScale);
  root.add(object3d);

  scene.updateMatrixWorld(true);
  const baseBox = new THREE.Box3().setFromObject(object3d);
  const baseCenter = new THREE.Vector3();
  baseBox.getCenter(baseCenter);
  object3d.position.x -= baseCenter.x;
  updateBookLayout(width, height);

  const state = {
    active: true,
    exiting: false,
    exitStart: 0,
    raf: null
  };
  home3d = state;

  const animate = () => {
    if (!state.active) {
      return;
    }

    if (state.exiting) {
      const elapsed = performance.now() - state.exitStart;
      const t = Math.min(1, elapsed / INTRO_EXIT_MS);
      const movePhase = Math.min(1, t / INTRO_MOVE_ONLY_RATIO);
      const revealPhase = Math.max(0, Math.min(1, (t - INTRO_MOVE_ONLY_RATIO) / (1 - INTRO_MOVE_ONLY_RATIO)));
      const easeMove = 1 - Math.pow(1 - movePhase, 3);
      const easeReveal = 1 - Math.pow(1 - revealPhase, 3);

      root.rotation.x = basePitch * (1 - easeReveal);
      root.rotation.y = 0;
      root.position.x = rootBaseX + (rootExitX - rootBaseX) * easeMove;
      root.position.y = rootBaseY;
      object3d.scale.set(baseScale, baseScale, baseScale);
      object3d.setOpenAmount(easeReveal);
      camera.position.z = cameraBaseZ + (cameraExitZ - cameraBaseZ) * easeReveal;
      camera.lookAt(0, 0, 0);
    } else {
      current.x += (target.x - current.x) * 0.16;
      current.y += (target.y - current.y) * 0.16;
      root.rotation.x = basePitch + current.x;
      root.rotation.y = current.y;
      root.position.x = rootBaseX;
      root.position.y = rootBaseY;
      object3d.setOpenAmount(0);
      camera.position.z = cameraBaseZ;
      camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
    state.raf = requestAnimationFrame(animate);
  };

  const handleResize = () => {
    const rect = book3dStage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    updateBookLayout(w, h);
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(book3dStage);
  animate();

  window.addEventListener("beforeunload", () => {
    state.active = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
    }
    resizeObserver.disconnect();
    window.removeEventListener("pointermove", applyPointer);
    window.removeEventListener("pointerout", handlePointerOut);
    window.removeEventListener("blur", resetPointer);
    renderer.dispose();
  });
}

function startReading() {
  if (!home3d || home3d.exiting) {
    return;
  }
  if (homeActions) {
    homeActions.classList.add("is-fading");
  }
  home3d.exiting = true;
  home3d.exitStart = performance.now();
  window.setTimeout(() => {
    window.location.href = READER_URL;
  }, INTRO_EXIT_MS);
}

if (startReadingBtn) {
  startReadingBtn.addEventListener("click", startReading);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startReading();
  }
});

(async function init() {
  await loadBookMeta();
  initHome3D();
})();
