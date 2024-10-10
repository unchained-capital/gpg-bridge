# GPG-BRIDGE

At the moment, the FIDO standard does not include a way to access public
key signing services from a FIDO device from a web page. This project
represents the need for a short term workaround until such functionality
is available.

As such this project implements a WebSocket server that can run locally on
a users machine which will  execute GPG commands via the GPG CLI based on
incoming requests.  Separately, GPG can be configured to work with a device
that implements a smart card interface to allow the actual cryptographic
signing to take place on trusted hardware.

## Warning

This project is very much a work in progress. It is certainly not
ready for general use.

## How to run

- Install dependencies: `bun i`
- If you have a custom npm registry configured, you might need to do

```
export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
bun install
```

- Run the server `bun dev`

Now you can access it from the command line using [websocat](https://github.com/vi/websocat).

```bash
echo '{"command": "sign", "message": "SGVsbG8sIHdvcmxkIQ==", "fingerprint": "YOUR_GPG_KEY_FINGERPRINT"}' | websocat ws://localhost:5151
```

# How to compile for "prod" into single-executable.

`bun compile`

This will create a single executable in the `dist` folder for the specific platform you're running on.

## TODO

- Should show itself in the system tray.
- installable without hassle.
- configure what key you're signing with.
