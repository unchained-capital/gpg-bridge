// main.js

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
} = require("electron");
const path = require("path");
const WebSocket = require("ws");
const { exec, spawn } = require("child_process");
const fs = require("fs").promises;
const kill = require("kill-port");
const { z } = require("zod");

// Schema Definitions
const GpgKeySchema = z.object({
  fingerprint: z.string(),
  uid: z.string(),
  pubkey: z.string(),
});

const OutboundPayloadSchema = z.object({
  message: z.string().optional(),
  communication: z.string(),
  signature: z.string().optional(),
  error: z.string().optional(),
  gpgkeys: z.array(GpgKeySchema).optional(),
});

const InboundPayloadSchema = z.object({
  command: z.enum(["sign", "getkeys"]),
  message: z.string().optional(),
  fingerprint: z.string().optional(),
});

// Electron App Variables
let mainWindow;
let tray = null;

// Function to create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile("index.html");

  // Wait for the window to finish loading before setting up the WebSocket server
  mainWindow.webContents.on("did-finish-load", () => {
    setupWebSocketServer();
  });
}

// Function to create the system tray
function createTray() {
  tray = new Tray(path.join(__dirname, "icons", "png", "32x32.png"));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show GPG Bridge UI",
      click: () => {
        mainWindow.show();
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

// Function to send messages to the renderer process
function sendToRenderer(channel, data) {
  mainWindow.webContents.send(channel, data);
}

// WebSocket Server Setup
let wss;

async function setupWebSocketServer() {
  // Kill any existing server on port 5151
  try {
    await kill(5151);
    console.log("Killed existing process on port 5151.");
  } catch (e) {
    console.log("Port 5151 is free.");
  }

  wss = new WebSocket.Server({ port: 5151 });

  wss.on("connection", (ws) => {
    console.log("WebSocket connection opened.");

    ws.on("message", async (message) => {
      console.log("Received message from client:", message);

      try {
        const parsedPayload = InboundPayloadSchema.parse(JSON.parse(message));

        if (parsedPayload.command === "sign") {
          await handleSignRequest(
            ws,
            parsedPayload.message,
            parsedPayload.fingerprint
          );
        } else if (parsedPayload.command === "getkeys") {
          await handleGetGpgPubKeys(ws);
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

  // Send initial server status to the renderer
  sendToRenderer("server-status", { running: true, port: 5151 });

  // Optionally, handle server closure
  wss.on("close", () => {
    sendToRenderer("server-status", { running: false });
  });
}

// Helper Functions

async function handleSignRequest(ws, messageToSign, fingerprint) {
  try {
    // Decode the message from base64
    const decodedMessage = Buffer.from(messageToSign, "base64");

    // Define the temporary directory path
    const tempDir = path.join(__dirname, "temp");

    // Ensure the 'temp' directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Define the temporary file path
    const tempFilePath = path.join(tempDir, `message_${Date.now()}.txt`);
    await fs.writeFile(tempFilePath, decodedMessage);

    // Notify the client about the signing process
    sendMessage(ws, {
      communication: "Signing process started. Please touch your YubiKey.",
    });

    // Execute the GPG command to sign the message using spawn
    const signProcess = spawn("gpg", [
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

    signProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    signProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    signProcess.on("close", async (code) => {
      try {
        // Clean up the temporary file
        await fs.unlink(tempFilePath);
      } catch (cleanupError) {
        console.error("Error cleaning up temp file:", cleanupError);
      }

      if (code === 0) {
        // Signing successful
        sendMessage(ws, {
          communication: "Message has been signed successfully.",
          message: messageToSign,
          signature: stdout,
        });
      } else {
        // Signing failed
        sendMessage(ws, { communication: "Signing process failed." });
        sendMessage(ws, {
          communication: "Signing failed",
          error: stderr,
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
    // Use exec here as the output is relatively small
    exec("gpg --list-keys --with-colons", async (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr));
      }

      const lines = stdout.split("\n");
      const keys = [];
      let currentKey = {};

      lines.forEach((line) => {
        const parts = line.split(":");
        if (parts[0] === "pub") {
          currentKey = {
            fingerprint: "",
            uid: "",
            pubkey: "",
          };
        } else if (parts[0] === "fpr") {
          currentKey.fingerprint = parts[9];
        } else if (parts[0] === "uid") {
          currentKey.uid = parts[9];
          keys.push({ ...currentKey });
        }
      });

      // Fetch armored keys using exec with Promises
      try {
        const armoredKeys = await Promise.all(
          keys.map((key) =>
            execPromise(
              `gpg --export --armor --export-options export-minimal ${key.fingerprint}!`
            ).then(
              ({ stdout }) => stdout,
              () => "Failed to retrieve pubkey."
            )
          )
        );

        keys.forEach((key, index) => {
          key.pubkey = armoredKeys[index];
        });

        resolve(keys);
      } catch (err) {
        // If fetching any key fails, mark its pubkey accordingly
        keys.forEach((key) => {
          key.pubkey = "Error retrieving pubkey.";
        });
        resolve(keys);
      }
    });
  });
}

function execPromise(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function sendMessage(ws, payload) {
  try {
    const validatedPayload = OutboundPayloadSchema.parse(payload);
    ws.send(JSON.stringify(validatedPayload));
  } catch (error) {
    console.error("Invalid outbound payload:", error);
  }
}

// Initialize Temporary Directory on App Startup
async function initializeApp() {
  // Define the temporary directory path
  const tempDir = path.join(__dirname, "temp");

  // Ensure the 'temp' directory exists
  try {
    await fs.mkdir(tempDir, { recursive: true });
    console.log("Temp directory is ready.");
  } catch (error) {
    console.error("Failed to create temp directory:", error);
    // You might choose to quit the app if temp directory creation fails
    app.quit();
  }

  // Continue with other initialization tasks if necessary
}

// Electron App Event Listeners
app.whenReady().then(async () => {
  await initializeApp(); // Ensure 'temp' directory is created
  createWindow();
  createTray();
  setupLogging();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function setupLogging() {
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    const logMessage = `${new Date().toISOString()} - LOG: ${args.join(" ")}`;
    originalLog.apply(console, args);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("log-message", logMessage);
    }
  };

  console.error = (...args) => {
    const logMessage = `${new Date().toISOString()} - ERROR: ${args.join(" ")}`;
    originalError.apply(console, args);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("log-message", logMessage);
    }
  };
}
