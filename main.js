const { app, BrowserWindow, Tray, Menu } = require("electron");
const path = require("path");
const WebSocket = require("ws");
const { execFile, spawn } = require("child_process");
const fs = require("fs").promises;
const kill = require("kill-port");
const { z } = require("zod");
const tmp = require("tmp-promise")
tmp.setGracefulCleanup()

// Temporary directory location
let tempDir

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
  const GPG_PATH = await findGpgPath();
  try {
    // Decode the message from base64
    const decodedMessage = Buffer.from(messageToSign, "base64");

    // Define the temporary file path
    const tempFilePath = path.join(tempDir.name, `message_${Date.now()}.txt`);
    await fs.writeFile(tempFilePath, decodedMessage);

    // Notify the client about the signing process
    sendMessage(ws, {
      communication: "Signing process started. Please touch your YubiKey.",
    });

    // Send a message to the renderer process to update the UI
    sendToRenderer(
      "yubikey-touch-required",
      "You may need to touch your YubiKey to sign."
    );

    if (!GPG_PATH) {
      const errorMsg = "GPG executable not found.";
      console.error(errorMsg);
      sendMessage(ws, {
        communication: "Failed to start GPG process",
        error: errorMsg,
      });
      return;
    }

    // Execute the GPG command to sign the message using spawn
    const signProcess = spawn(GPG_PATH, [
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

    signProcess.on("error", (error) => {
      console.error("Error spawning GPG process:", error.message);
      sendMessage(ws, {
        communication: "Failed to start GPG process",
        error: error.message,
      });
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
        // Inform the renderer that the signing is complete
        sendToRenderer("yubikey-touch-complete", "Signing process completed.");
      } else {
        // Signing failed
        console.error("GPG signing process failed:", stderr);
        sendMessage(ws, { communication: "Signing process failed." });
        sendMessage(ws, {
          communication: "Signing failed",
          error: stderr,
        });
      }
    });
  } catch (error) {
    console.error("Error in sign request:", error);
    sendMessage(ws, {
      communication: "Internal server error",
      error: error.message,
    });
  }
}

async function handleGetGpgPubKeys(ws) {
  try {
    const keys = await getGpgKeys();
    if (keys && keys.length > 0) {
      console.log("GPG keys retrieved successfully.");
      sendMessage(ws, { communication: "Keys retrieved.", gpgkeys: keys });
    } else {
      console.log("No GPG keys found.");
      sendMessage(ws, { communication: "No GPG keys found." });
    }
  } catch (error) {
    console.error("Error retrieving GPG keys:", error);
    sendMessage(ws, {
      communication: "Failed to retrieve keys.",
      error: error.message,
    });
  }
}

async function getGpgKeys() {
  const GPG_PATH = await findGpgPath();
  return new Promise((resolve, reject) => {
    if (!GPG_PATH) {
      const errorMsg = "GPG executable not found.";
      console.error(errorMsg);
      return reject(new Error(errorMsg));
    }

    execFile(
        GPG_PATH,
      ["--list-keys", "--with-colons"],
      async (error, stdout, stderr) => {
        if (error) {
          console.error("Error listing GPG keys:", stderr);
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
                `${GPG_PATH} --export --armor --export-options export-minimal ${key.fingerprint}!`
              ).then(
                ({ stdout }) => {
                  console.log("Armored key:", stdout);
                  return stdout;
                },
                (err) => {
                  console.error("Failed to retrieve pubkey.", err);
                  return "Failed to retrieve pubkey.";
                }
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
      }
    );
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
  tempDir = await tmp.dir()

  // Continue with other initialization tasks if necessary
}

// Function to find the GPG executable
async function findGpgPath() {
  const possiblePaths = [
    "/usr/local/bin/gpg",
    "/opt/homebrew/bin/gpg", // For Apple Silicon Macs with Homebrew
    "/usr/bin/gpg",
    "/bin/gpg",
    "/opt/local/bin/gpg", // MacPorts installation path
    "/snap/bin/gpg", // Snap package installation path on Linux

    "C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe", // Windows path (32-bit)
    "C:\\Program Files\\GnuPG\\bin\\gpg.exe", // Windows path (64-bit)
    "C:\\Program Files\\Git\\usr\\bin\\gpg.exe", // Git for Windows path

    process.env.ProgramFiles + "\\GnuPG\\bin\\gpg.exe", // Dynamic Windows path
    process.env["ProgramFiles(x86)"] + "\\GnuPG\\bin\\gpg.exe", // Dynamic Windows path (32-bit)

    // Add more paths if needed
  ];

  // Check if gpg is in PATH
  try {
    const { stdout } = await execPromise("which gpg || where gpg");
    console.log("which gpg || where gpg", stdout.trim());
    if (stdout.trim()) {
      possiblePaths.unshift(stdout.trim());
    }
  } catch (error) {
    console.log("GPG not found in PATH");
  }

  for (const path of possiblePaths) {
    console.log("Checking path hard coded path:", path);
    try {
      await fs.access(path, fs.constants.X_OK);
      console.log("GPG found at:", path);
      return path;
    } catch (error) {
      // Path not accessible or not executable, continue to next path
    }
  }

  console.error("GPG not found in any known paths.");
  return null;
}

// Electron App Event Listeners
app.whenReady().then(async () => {
  await initializeApp(); // Ensure 'temp' directory is created
  createWindow();
  createTray();
  setupLogging();

  console.log("Current PATH:", process.env.PATH);

  const GPG_PATH = await findGpgPath();
  console.log("Using GPG path:", GPG_PATH);

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
