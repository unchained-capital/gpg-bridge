require("dotenv").config();
const pkg = require("./package.json")

const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const {createCertificates } = require('./certs.js');

createCertificates();

module.exports = {
  packagerConfig: {
    asar: false,
    icon: "./icons/icon",
    // osxSign: {
    //   identity: "Apple Development: Joe Brauckmann (Z7RDUD6WJ5)",
    //   "hardened-runtime": true,
    //   entitlements: "entitlements.plist",
    //   "entitlements-inherit": "entitlements.plist",
    //   "signature-flags": "library",
    //   "gatekeeper-assess": false,
    //   verbose: true, // Add this line for more detailed logging
    // },
    // osxNotarize: {
    //   tool: "notarytool",
    //   appleId: process.env.APPLE_ID,
    //   appleIdPassword: process.env.APPLE_PASSWORD,
    //   teamId: process.env.APPLE_TEAM_ID,
    // },
    // ignore: [/^\/src/, /^\/test/, /^\/scripts/, /^\/\.vscode/, /^\/\.git/],
  },
  rebuildConfig: {
    force: true,
  },
  makers: [
    {
      name: "@electron-forge/maker-wix",
      config: {
        name: "GPGBridge",
        language: 1033,
        manufacturer: "Unchained",
        //exe: "GPGBridge.exe",
        icon: "./icons/win/icon.ico",
        version: pkg.version,
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
      config: {
        icon: "./icons/mac/icon.icns",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          icon: "./icons/png/256x256.png",
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          icon: "./icons/png/256x256.png",
        },
      },
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        icon: "./icons/mac/icon.icns",
      },
    },
  ],
  plugins: [
    // {
    //   name: "@electron-forge/plugin-auto-unpack-natives",
    //   config: {},
    // },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "unchained-capital",
          name: "gpg-bridge",
        },
        prerelease: false,
      },
    },
  ],
};
