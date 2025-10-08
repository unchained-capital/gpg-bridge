const path = require("path");
const fs = require("fs");

const keyNameRegex = /^cert(?:ificate)?\.key$|^key\.pem$/i;
const certNameRegex = /^cert(?:ificate)?\.(?:crt|pem)$/i;

const assetsDir = path.join(__dirname, 'assets');

function findCertificates() {
  const certDir = path.join(assetsDir, 'cert');
  const candidates = fs.readdirSync(certDir);
  const keyNames = candidates.filter(name => keyNameRegex.test(name));
  const certNames = candidates.filter(name => certNameRegex.test(name));
  
  const errors = [];
  for (const [a, b] of [[keyNames, 'key'], [certNames, 'certificate']]) {
    if (a.length === 0) {
      errors.push(`No ${b} file.`); 
    } else if (a.length > 1) {
      errors.push(`Multiple ${b} files.`); 
    }
  }

  if (keyNames.length === 0 && certNames.length === 0) {
    return {noCertFiles: true, badCertFiles: false, certDir, keyFilename: null, certFilename: null, errors}
  }
  if (errors.length > 0) {
    return {noCertFiles: false, badCertFiles: true, certDir, keyFilename: null, certFilename: null, errors}
  }

  const keyFilename = path.join(certDir, keyNames[0]);
  const certFilename = path.join(certDir, certNames[0]);
  return {keyFilename, certFilename, noCertFiles: false, badCertFiles: false, certDir, errors};
}

function loadCertificates() {
  const result = findCertificates();
  if (result.noCertFiles) {
    throw new Error(`No certificate files found in '${result.certDir}'.`);
  }
  if (result.badCertFiles) {
    throw new Error(`Ambiguous or incomplete certificate files found in '${result.certDir}'. ${result.errors.join(' ')}`);
  }
  const [privateKey, certificate] = [
    fs.readFileSync(result.keyFilename, 'utf8'),
    fs.readFileSync(result.certFilename, 'utf8'),
  ];
  return {privateKey, certificate};
}

function createCertificates() {
  const result = findCertificates();
  if (result.badCertFiles) {
    const msg = `Ambiguous or incomplete certificate files found in '${result.certDir}'. ${result.errors.join(' ')}`;
    console.error(msg);
    console.error('Throwing error because the built app will likely fail.')
    throw new Error(msg);
  }
  if (!result.noCertFiles) {
    console.log('INFO Certificate files already present. NOT creating certificates.');
    return;
  }
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

