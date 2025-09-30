window.api.onServerStatus((event, data) => {
  const statusElement = document.getElementById("status");
  if (data.running) {
    statusElement.textContent = `WebSocket server is running on localhost:${data.port}`;
  } else {
    statusElement.textContent = "WebSocket server is not running";
  }
  if (data.passCode) {
    const passCodeElement = document.getElementById("passcode");
    passCodeElement.textContent = `Passcode: ${data.passCode}`;
  }
});

window.electron.onYubiKeyTouchRequired((message) => {
  document.getElementById("yubikey-message").textContent = message;
  document.getElementById("yubikey-prompt").style.display = "block";
});

window.electron.onYubiKeyTouchComplete((message) => {
  document.getElementById("yubikey-message").textContent = message;
  setTimeout(() => {
    document.getElementById("yubikey-prompt").style.display = "none";
  }, 3000);
});
