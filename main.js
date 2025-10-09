const { app, BrowserWindow, Tray, Menu } = require("electron");
if (require('electron-squirrel-startup')) app.quit();
const path = require("path");
const WebSocket = require("ws");
const { execFile, spawn } = require("child_process");
const fs = require("fs").promises;
const { z } = require("zod");
const { createServer } = require('https');
const tmp = require("tmp-promise")
const isMac = process.platform === 'darwin'

const { loadCertificates } = require('./certs.js');

tmp.setGracefulCleanup()

// Temporary directory location
let tempDir

// gpg path - we use this global variable to memo-ise the findGpgPath function
let GPG_Path = null

// Schema Definitions
const GpgKeySchema = z.object({
  fingerprint: z.string(),
  uid: z.string(),
  pubkey: z.string(),
});

const OutboundPayloadSchema = z.object({
  message: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  communication: z.string(),
  signature: z.string().optional(),
  error: z.string().optional(),
  gpgkeys: z.array(GpgKeySchema).optional(),
});

const InboundPayloadSchema = z.object({
  command: z.enum(["sign", "getkeys", "version", "importkey", "passcode"]),
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
  mainWindow.webContents.on("did-finish-load", async () => {
    console.log(`${app.getName()} ${app.getVersion()}`)
    const GPG_PATH = await findGpgPath();
    console.log("Using gpg executable ", GPG_PATH);
    setupWebSocketServer();

  });

  const template = [
    // { role: 'appMenu' }
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    // { role: 'fileMenu' }
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About',
          click: async () => {
            const { shell } = require('electron')
            await shell.openExternal('https://github.com/unchained-capital/gpg-bridge')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

const acceptableRemoteHosts = ['::1', '127.0.0.1', 'localhost'];

const passCode = Math.random().toString().substring(2, 8).padEnd(6, '0');
console.log('INFO passCode =', passCode);

// WebSocket Server Setup

let wss;
let httpsServer;

const assetsDir = path.join(__dirname, 'assets');
console.log('INFO assetsDir =', assetsDir);

async function setupWebSocketServer() {
  try {
    const {privateKey, certificate} = await loadCertificates();
    const credentials = { key: privateKey, cert: certificate };

    httpsServer = createServer(credentials);
    wss = new WebSocket.Server({ 
      // we hook the server up below so we can serve an HTML page too.
      noServer: true,
      verifyClient: ({secure, req}) => {
        if (!secure) {
          return false;
        }
        const remoteHost = req?.socket?.remoteAddress ?? 'NULL';
        if (!acceptableRemoteHosts.includes(remoteHost)) {
          return false;
        }
        return true;
      }
    });
  } catch (e) {
    console.error(e);
    console.log("Error starting server on port 5151")
    console.error("Shutting down in 5 seconds");
    setTimeout(() => { app.quit(); }, 5000);
  }

  wss.on("error", (msg) => {
    console.error(msg);
    console.error("Shutting down in 5 seconds");
    setTimeout(() => { app.quit(); }, 5000);
  });

  wss.on("connection", (ws) => {
    console.log("WebSocket connection opened.");

    let authenticated = false;

    ws.on("message", async (message) => {
      try {
        const parsedPayload = InboundPayloadSchema.parse(JSON.parse(message));

        if (parsedPayload.command === "passcode") {
          if (parsedPayload.message === passCode) {
            authenticated = true;
            sendMessage(ws, { communication: "Authentication successful." });
            return;
          } else {
            sendMessage(ws, { communication: "Incorrect passcode." });
            return;
          }
        }
        
        if (!authenticated) {
          sendMessage(ws, { communication: "You must authenticate." });
          return;
        }
        if (parsedPayload.command === "sign") {
          await handleSignRequest(
            ws,
            parsedPayload.message,
            parsedPayload.fingerprint
          );
        } else if (parsedPayload.command === "getkeys") {
          await handleGetGpgPubKeys(ws);
        } else if (parsedPayload.command === "version") {
          await handleGetVersion(ws);
        } else if (parsedPayload.command === "importkey") {
          await handleImportKey(ws, parsedPayload.message);
        }
        else {
          sendMessage(ws, { communication: "Unknown command." });
          console.error(`Unknown command ${parsedPayload.command}`)
        }
      } catch (error) {
        sendMessage(ws, { communication: "Invalid payload." });
        console.error(`Invalid payload. ${error}`)
      }
    });

    ws.on("close", (code, reason) => {
      console.log(
        `WebSocket connection closed. Code: ${code}, Reason: ${reason}`
      );
    });
  });

  // Send initial server status to the renderer
  sendToRenderer("server-status", { running: true, port: 5151, passCode });

  // Optionally, handle server closure
  wss.on("close", () => {
    sendToRenderer("server-status", { running: false });
  });

  httpsServer.on('upgrade', function upgrade(request, socket, head) {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit('connection', ws, request);
    });
  });
  const pathModule = path;
  httpsServer.on('request', async function(req, res) {
    const {method, url} = req;
    if (method !== 'GET') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }

    const contentMap = {
      '/connect': {
        encoding: 'utf8',
        contentType: 'text/html',
        path: pathModule.join(assetsDir, 'success.html'),
      },
      '/assets/bridge.png': {
        encoding: undefined,
        contentType: 'image/png',
        path: pathModule.join(assetsDir, 'bridge.png'),
      },
      '/assets/favicon.png': {
        encoding: undefined,
        contentType: 'image/png',
        path: pathModule.join(assetsDir, 'Unchained_Favicon.png'),
      }
    }
    const content = contentMap[url];
    if (!content) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }

    const { encoding, contentType, path } = content;
    const body = await fs.readFile(path, encoding);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
  });

  httpsServer.listen(5151, () => {
      console.log('Secure WebSocket server listening on port 5151');
  });
}

// Helper Functions

async function handleSignRequest(ws, messageToSign, fingerprint) {
  const GPG_PATH = await findGpgPath();
  try {
    // Decode the message from base64
    const decodedMessage = Buffer.from(messageToSign, "base64");

    // Define the temporary file path
    const tempFilePath = path.join(tempDir.path, `message_${Date.now()}.txt`);
    await fs.writeFile(tempFilePath, decodedMessage);

    // Notify the client about the signing process
    sendMessage(ws, {
      communication: "Signing process started. Please touch your YubiKey.",
    });

    console.log(`Signing message with key\n${fingerprint}`)

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
        console.log(`Successfully signed message with\n${fingerprint}.`)
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
        sendToRenderer("yubikey-touch-complete", "Signing process failed.");
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
  console.log("Retrieving GPG public keys.")
  try {
    const keys = await getGpgKeys();
    if (keys && keys.length > 0) {
      console.log("GPG keys retrieved successfully.");
      sendMessage(ws, { communication: "Keys retrieved.", gpgkeys: keys });
    } else {
      console.error("No GPG keys found.");
      sendMessage(ws, { communication: "No GPG keys found.", gpgkeys: [] });
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
                 GPG_PATH,
                 [
                    "--export", "--armor", "--export-options",
                    "export-minimal", `${key.fingerprint}!`
                 ]
              ).then(
                ({ stdout }) => {
                  key.pubkey = stdout;
                },
                (err) => {
                  console.error(`Failed to retrieve pubkey ${key.fingerprint}.`, err);
                  key.pubkey = null;
                }
              )
            )
          );

          resolve(keys.filter((key)=>key.pubkey));
        } catch (err) {
          reject("Error retrieving keys");
        }
      }
    );
  });
}

async function handleGetVersion(ws) {
  sendMessage(ws, {
    name: app.getName(),
    version: app.getVersion(),
    communication: "version",
  });
}


function execPromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
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
  if (GPG_Path) {
    return GPG_Path;
  }
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
    const { stdout } = await execPromise("which", ["gpg"]);
    if (stdout.trim()) {
      possiblePaths.unshift(stdout.trim());
    }
  } catch (error) {
    try {
      const { stdout } = await execPromise("where", ["gpg"]);
      if (stdout.trim()) {
        possiblePaths.unshift(stdout.trim());
      }
    } catch (error) {
      console.warn("GPG not found in PATH");
    }
  }

  for (const path of possiblePaths) {
    try {
      await fs.access(path, fs.constants.X_OK);
      GPG_Path = path;
      return path;
    } catch (error) {
      // Path not accessible or not executable, continue to next path
    }
  }

  console.error("GPG not found in any known paths.");
  return null;
}

setupLogging();

// Electron App Event Listeners
app.whenReady().then(async () => {
  await initializeApp(); // Ensure 'temp' directory is created
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      }
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.exit(0);
  }
});

function setupLogging() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn

  console.log = (...args) => {
    const logMessage = `${new Date().toLocaleTimeString()}  ${args.join(" ")}`;
    originalLog.apply(console, args);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("log-message", logMessage);
    }
  };

  console.error = (...args) => {
    const logMessage = `${new Date().toLocaleTimeString()}  ERROR: ${args.join(" ")}`;
    originalError.apply(console, args);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("log-message", logMessage);
    }
  };
  console.warn = (...args) => {
    const logMessage = `${new Date().toLocaleTimeString()}  WARNING: ${args.join(" ")}`;
    originalWarn.apply(console, args);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("log-message", logMessage);
    }
  };

}

/**
 * @async
 * @param {WebSocket} ws - The WebSocket connection to respond through
 * @param {string} pgpPublicKey - The base64 encoded PGP key to import
 * @returns {Promise<void>}
 * @description Processes an incoming PGP key from a client and imports it to the system's keyring
 */
async function handleImportKey(ws, pgpPublicKey) {
  const GPG_PATH = await findGpgPath();
  try {
    const decodedMessage = Buffer.from(pgpPublicKey, "base64");
    const tempFilePath = path.join(tempDir.path, `key_${Date.now()}.asc`);
    await fs.writeFile(tempFilePath, decodedMessage);

    console.log("Key import process started.");
    sendMessage(ws, {
      communication: "Key import process started.",
    });

    if (!GPG_PATH) {
      const errorMsg = "GPG executable not found.";
      console.error(errorMsg);
      sendMessage(ws, {
        communication: "Failed to start GPG process",
        error: errorMsg,
      });
      return;
    }

    const ps = spawn(GPG_PATH, [
      "--import",
      tempFilePath,
    ]);

    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ps.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ps.on("error", (error) => {
      console.error("Error spawning GPG process:", error.message);
      sendMessage(ws, {
        communication: "Failed to start GPG process",
        error: error.message,
      });
    });

    ps.on("close", async (code) => {
      try {
        await fs.unlink(tempFilePath);
      } catch (cleanupError) {
        console.error("Error cleaning up temp file:", cleanupError);
      }

      if (code === 0) {
        console.log("Key successfully imported.")
        sendMessage(ws, {
          communication: "Key successfully imported.",
          message: "done",
          out: stdout,
        });
      } else {
        console.error("GPG import process failed:", stderr);
        sendMessage(ws, { communication: "Import process failed." });
        sendMessage(ws, {
          communication: "import failed failed",
          error: stderr,
        });
      }
    });
  } catch (error) {
    console.error("Error in import request:", error);
    sendMessage(ws, {
      communication: "Internal server error",
      error: error.message,
    });
  }
}

