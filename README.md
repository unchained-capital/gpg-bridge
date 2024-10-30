# GPG-BRIDGE

At the moment, the FIDO standard does not include a way to access public
key signing services from a FIDO device from a web page. This project
represents the need for a short term workaround until such functionality
is available.

As such this project implements a WebSocket server that can run locally on
a users machine which will execute GPG commands via the GPG CLI based on
incoming requests. Separately, GPG can be configured to work with a device
that implements a smart card interface to allow the actual cryptographic
signing to take place on trusted hardware.

## Warning

This project is very much a work in progress. It is certainly not
ready for general use.

## How to run

- Install dependencies: `npm i`
- If you have a custom npm registry configured, you might need to do

```
export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
npm install
```

- Run the server `npm run start`

Now you can access it from the command line using [websocat](https://github.com/vi/websocat).

```bash
echo '{"command": "sign", "message": "SGVsbG8sIHdvcmxkIQ==", "fingerprint": "YOUR_GPG_KEY_FINGERPRINT"}' | websocat ws://localhost:5151
```

# How to compile for "prod" into single-executable.

`npm run make:all`

This will create a single executable in the `dist` folder for the specific platform you're running on.

## TODO

- [x] Should show itself in the system tray.
- [x] Show itself in the task bar.
- [x] Better UI
- [ ] installable without hassle.
