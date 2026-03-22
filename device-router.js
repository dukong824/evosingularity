(() => {
  const MOBILE_UA_PATTERN =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const PATHS = {
    mobile: "mobile.html",
    desktop: "desktop.html"
  };

  function isLikelyMobileDevice() {
    const ua = navigator.userAgent || "";
    const uaDataMobile = Boolean(navigator.userAgentData?.mobile);
    return MOBILE_UA_PATTERN.test(ua) || uaDataMobile;
  }

  function buildTargetURL(version) {
    const targetFile = PATHS[version] || PATHS.desktop;
    const scriptTag = document.querySelector('script[src$="device-router.js"]');
    const baseURL =
      scriptTag && scriptTag.src
        ? new URL(".", scriptTag.src)
        : new URL(".", window.location.href);
    const nextURL = new URL(targetFile, baseURL);
    nextURL.search = window.location.search;
    nextURL.hash = window.location.hash;
    return nextURL;
  }

  function getPreferredVersion() {
    return isLikelyMobileDevice() ? "mobile" : "desktop";
  }

  function isSameLocation(nextURL) {
    return (
      window.location.pathname === nextURL.pathname &&
      window.location.search === nextURL.search &&
      window.location.hash === nextURL.hash
    );
  }

  function redirect(version) {
    const nextURL = buildTargetURL(version);
    if (isSameLocation(nextURL)) {
      return;
    }
    window.location.replace(nextURL.href);
  }

  function redirectByDevice() {
    const preferred = getPreferredVersion();
    redirect(preferred);
  }

  function guard(currentVersion) {
    const preferred = getPreferredVersion();
    if (preferred !== currentVersion) {
      redirect(preferred);
    }
  }

  window.DeviceRouter = {
    isLikelyMobileDevice,
    getPreferredVersion,
    redirectByDevice,
    guard
  };
})();
