(() => {
  if (window.DeviceRouter?.redirectByDevice) {
    window.DeviceRouter.redirectByDevice();
    return;
  }

  window.location.replace("./desktop.html");
})();
