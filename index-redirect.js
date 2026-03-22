(() => {
  try {
    if (window.DeviceRouter?.redirectByDevice) {
      window.DeviceRouter.redirectByDevice();
      return;
    }
  } catch (error) {
    // no-op fallback below
  }

  window.location.replace("./desktop.html");
})();
