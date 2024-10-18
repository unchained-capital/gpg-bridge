window.api.onServerStatus((event, data) => {
  const statusElement = document.getElementById("status");
  if (data.running) {
    statusElement.textContent = `WebSocket server is running on localhost:${data.port}`;
  } else {
    statusElement.textContent = "WebSocket server is not running";
  }
});
