# GPG-BRIDGE

A WebSocket server executing GPG commands via the GPG CLI based on incoming requests.

# How to run

- Install dependencies: `bun i`
- If you have a custom npm registry configured, you might need to do

```
export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
bun install
```

- Run the server `bun dev`

Now you can curl it

```bash
echo '{"command": "sign", "message": "SGVsbG8sIHdvcmxkIQ==", "fingerprint": "YOUR_GPG_KEY_FINGERPRINT"}' | websocat ws://localhost:5151
```

# How to compile for "prod" into single-executable.

`bun compile`

This will create a single executable in the `dist` folder for the specific platform you're running on.

## TODO

- Should show itself in the system tray.
- installable without hassble.
- configure what key you're signing with.
