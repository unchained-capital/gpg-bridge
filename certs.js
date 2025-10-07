const path = require("path");
const fs = require("fs");

const keyNameRegex = /^cert(?:ificate)?\.key$|^key\.pem$/i;
const certNameRegex = /^cert(?:ificate)?\.(?:crt|pem)$/i;

const assetsDir = path.join(__dirname, 'assets');

async function loadCertificates() {
  const certDir = path.join(assetsDir, 'cert');
  const candidates = fs.readdirSync(certDir);
  const keyname = candidates.find(name => keyNameRegex.test(name));
  const certname = candidates.find(name => certNameRegex.test(name));

  if (!keyname) {
    throw new Error('Expected file `assets/cert/cert.key` not found.');
  }
  if (!certname) {
    throw new Error('Expected file `assets/cert/cert.crt` not found.');
  }
  const [privateKey, certificate] = [
    fs.readFileSync(path.join(certDir, keyname), 'utf8'),
    fs.readFileSync(path.join(certDir, certname), 'utf8'),
  ];
  return {privateKey, certificate};
}

function createCertificates() {
  
  console.log('INFO Creating self signed certificate.');
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([
    { shortName: 'ST', value: 'Texas' },
    { name: 'countryName', value: 'US' },
    { name: 'localityName', value: 'Austin' },
    { name: 'organizationName', value: 'Unchained' },
    { name: 'commonName', value: 'GPG-Bridge' },
  ], {});
  
  const certDir = path.join(assetsDir, 'cert');
  fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
  fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);
}

module.exports = {loadCertificates, createCertificates};

