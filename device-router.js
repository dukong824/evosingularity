(() => {
  const MOBILE_UA_PATTERN =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

  function isLikelyMobileDevice() {
    const ua = navigator.userAgent || "";
    const uaDataMobile = Boolean(
      navigator.userAgentData && navigator.userAgentData.mobile
    );
    return MOBILE_UA_PATTERN.test(ua) || uaDataMobile;
  }

  function buildTargetURL(pathname) {
    const nextURL = new URL(pathname, window.location.href);
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.forEach((value, key) => nextURL.searchParams.set(key, value));
    nextURL.hash = window.location.hash;
    return nextURL.toString();
  }

  function getPreferredVersion() {
    return isLikelyMobileDevice() ? "mobile" : "desktop";
  }

  function getTargetPath(version) {
    return version === "mobile" ? "./mobile.html" : "./desktop.html";
  }

  function redirectFromIndex() {
    const preferred = getPreferredVersion();
    window.location.replace(buildTargetURL(getTargetPath(preferred)));
  }

  function guardCurrentPage(currentVersion) {
    const preferred = getPreferredVersion();
    if (preferred === currentVersion) {
      return;
    }
    window.location.replace(buildTargetURL(getTargetPath(preferred)));
  }

  window.DeviceRouter = {
    isLikelyMobileDevice,
    getPreferredVersion,
    redirectFromIndex,
    guardCurrentPage
  };
})();
