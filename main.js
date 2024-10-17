// main.js

const { app, BrowserWindow, Tray, Menu } = require("electron");
const path = require("path");
const WebSocket = require("ws");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const kill = require("kill-port");

let mainWindow;
let wss;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 200,
    icon: path.join(__dirname, "icons", "png", "32x32.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");
}

function createTray() {
  tray = new Tray(path.join(__dirname, "icons", "png", "32x32.png"));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show GPG Bridge UI",
      click: () => {
        mainWindow.show();
      },
    },
    {
      label: "Server Status",
      click: () => {
        // Add functionality to check and display server status
        const status = wss ? "Running" : "Stopped";
        mainWindow.webContents.send("server-status-update", status);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setToolTip("GPG Bridge");
  tray.setContextMenu(contextMenu);
}

async function main() {
  try {
    await kill(5151);
    console.log(
      "Something was running on port 5151 - killed it, proceeding..."
    );
  } catch (e) {
    console.log("Port 5151 was already free - proceeding...");
  }

  wss = new WebSocket.Server({ port: 5151 });

  wss.on("connection", (ws) => {
    console.log("WebSocket connection opened.");

    ws.on("message", (payload) => {
      console.log("Received message from client:", payload);

      try {
        const parsedPayload = JSON.parse(payload);

        if (parsedPayload.command === "sign") {
          handleSignRequest(
            ws,
            parsedPayload.message,
            parsedPayload.fingerprint
          );
        } else if (parsedPayload.command === "getkeys") {
          handleGetGpgPubKeys(ws);
        } else {
          sendMessage(ws, { communication: "Unknown command." });
        }
      } catch (error) {
        sendMessage(ws, { communication: "Invalid payload." });
      }
    });

    ws.on("close", (code, reason) => {
      console.log(
        `WebSocket connection closed. Code: ${code}, Reason: ${reason}`
      );
    });
  });

  console.log(`WebSocket server running at ws://localhost:5151`);
  mainWindow.webContents.send("server-status", { running: true, port: 5151 });
}

async function handleSignRequest(ws, messageToSign, fingerprint) {
  try {
    const decodedMessage = Buffer.from(messageToSign, "base64");
    const tempFilePath = `/tmp/message.txt`;
    await fs.writeFile(tempFilePath, decodedMessage);

    sendMessage(ws, {
      communication: "Signing process started. Please touch your YubiKey.",
    });

    const signCommand = spawn("gpg", [
      "--sign",
      "--detach-sign",
      "--armor",
      "--local-user",
      fingerprint,
      "--output",
      "-",
      "--no-tty",
      tempFilePath,
    ]);

    let stdout = "";
    let stderr = "";

    signCommand.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    signCommand.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    signCommand.on("close", async (exitCode) => {
      await fs.unlink(tempFilePath);

      if (exitCode === 0) {
        sendMessage(ws, {
          communication: "Message has been signed successfully.",
          message: messageToSign,
          signature: stdout,
        });
      } else {
        sendMessage(ws, { communication: "Signing process failed." });
        sendMessage(ws, {
          communication: "Signing failed",
          error: JSON.stringify(stderr),
        });
      }
    });
  } catch (error) {
    console.error("Error:", error);
    sendMessage(ws, {
      communication: "Internal server error",
      error: JSON.stringify(error),
    });
  }
}

async function handleGetGpgPubKeys(ws) {
  try {
    const keys = await getGpgKeys();
    if (keys) {
      sendMessage(ws, { communication: "Keys retrieved.", gpgkeys: keys });
    } else {
      console.log("No Keys found in the output.");
    }
  } catch (error) {
    sendMessage(ws, {
      communication: "Failed to retrieve keys.",
      error: error.message,
    });
  }
}

async function getGpgKeys() {
  return new Promise((resolve, reject) => {
    const gpgCommand = spawn("gpg", ["--list-keys"]);
    let stdout = "";

    gpgCommand.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    gpgCommand.on("close", async (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error("Failed to list GPG keys"));
        return;
      }

      const lines = stdout.split("\n");
      const keys = [];
      let currentKey;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("pub")) {
          currentKey = {};
          currentKey.fingerprint = lines[i + 1].trim();
        } else if (lines[i].startsWith("uid")) {
          currentKey.uid = lines[i].slice(3).trim();
          keys.push(currentKey);
        }
      }

      for (let key of keys) {
        const armoredKey = await new Promise((resolve, reject) => {
          const exportCommand = spawn("gpg", [
            "--export",
            "--armor",
            "--export-options",
            "export-minimal",
            `${key.fingerprint}!`,
          ]);
          let keyData = "";

          exportCommand.stdout.on("data", (data) => {
            keyData += data.toString();
          });

          exportCommand.on("close", (exitCode) => {
            if (exitCode === 0) {
              resolve(keyData);
            } else {
              reject(new Error("Failed to export GPG key"));
            }
          });
        });

        key.pubkey = armoredKey;
      }

      resolve(keys);
    });
  });
}

function sendMessage(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    console.error("Invalid outbound payload:", error);
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  main();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (wss) {
    wss.close();
  }
  if (process.platform !== "darwin") {
    // Instead of quitting, we'll hide the window
    mainWindow.hide();
  }
});
