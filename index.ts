import { config } from "dotenv";
config();
import { serve, $, type ServerWebSocket } from "bun";
import { z } from "zod";
import kill from "kill-port";

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

type OutboundPayload = z.infer<typeof OutboundPayloadSchema>;

const InboundPayloadSchema = z.object({
  command: z.enum(["sign", "getkeys"]),
  message: z.string().optional(),
  fingerprint: z.string().optional(),
});

type InboundPayload = z.infer<typeof InboundPayloadSchema>;

type GpgKey = z.infer<typeof GpgKeySchema>;

// main
async function main() {
  // kill anything on port 5151 first
  await kill(5151)
    .then((dump: any) =>
      console.log(
        "Something was running on port 5151 - killed it, proceeding..."
      )
    )
    .catch((e: Error) => {
      console.log("Port 5151 was already free - proceeding...");
    })
    .finally(() => {
      // Start server
      serve({
        port: 5151, // TODO: Use process.env.PORT to make configurable?
        fetch(req: Request, server: any): Response | void {
          // Upgrade the request to a WebSocket
          if (server.upgrade(req)) {
            return;
          }
          return new Response("Upgrade failed :(", { status: 500 });
        },
        websocket: {
          open(ws: ServerWebSocket<unknown>) {
            console.log("WebSocket connection opened.");
          },
          message(ws: ServerWebSocket<unknown>, payload: string) {
            console.log("Received message from client:", payload);

            try {
              const parsedPayload: InboundPayload = InboundPayloadSchema.parse(
                JSON.parse(payload)
              );

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
          },
          close(ws: ServerWebSocket<unknown>, code: number, message: string) {
            console.log(
              `WebSocket connection closed. Code: ${code}, Reason: ${message}`
            );
          },
        },
      });
      console.log(`WebSocket server running at ws://localhost:5151`);
    });
}

// ============== Helpers

async function handleSignRequest(ws, messageToSign, fingerprint) {
  try {
    // Decode the message from base64 - we just assume all messages are base64 on arrival
    const decodedMessage = Buffer.from(messageToSign, "base64");

    // Example: Temporarily write message to a file for GPG to sign
    const tempFilePath = `/tmp/message.txt`;
    Bun.write(tempFilePath, decodedMessage);

    // Notify the client about the signing process
    sendMessage(ws, {
      communication: "Signing process started. Please touch your YubiKey.",
    });

    // Execute the GPG command to sign the message
    const signCommand = $`gpg --sign --detach-sign --armor --local-user ${fingerprint} --output - --no-tty ${tempFilePath}`;
    const { stdout, stderr, exitCode } = await signCommand;

    // Clean up the temporary file
    await $`rm ${tempFilePath}`;

    if (exitCode === 0) {
      // Signing success, notify the client and send the signed message
      sendMessage(ws, {
        communication: "Message has been signed successfully.",
        message: messageToSign,
        signature: stdout.toString(),
      });
    } else {
      // Notify the client if signing fails
      sendMessage(ws, { communication: "Signing process failed." });
      sendMessage(ws, {
        communication: "Signing failed",
        error: JSON.stringify(stderr),
      });
    }
  } catch (error) {
    console.error("Error:", error);
    sendMessage(ws, {
      communication: "Internal server error",
      error: JSON.stringify(error),
    });
  }
}

async function handleGetGpgPubKeys(ws: ServerWebSocket<unknown>) {
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

export async function getGpgKeys() {
  const stdout = await $`gpg --list-keys`;

  const lines = stdout.text().split("\n");
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
    const armoredKey = await $`gpg --export --armor ${key.fingerprint}`;
    key.pubkey = armoredKey.text();
  }

  return keys satisfies Array<GpgKey>;
}

function sendMessage(ws: ServerWebSocket<unknown>, payload: OutboundPayload) {
  try {
    // Validate the payload
    const validatedPayload = OutboundPayloadSchema.parse(payload);

    // Send the payload to the client
    ws.send(JSON.stringify(validatedPayload));
  } catch (error) {
    console.error("Invalid outbound payload:", error);
  }
}

// execute:
main();
