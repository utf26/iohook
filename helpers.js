const path = require('path');
const fs = require('fs');

/**
 * Return options for iohook from package.json
 * @return {Object}
 */
function optionsFromPackage(attempts, mainPath = './') {
  attempts = attempts || 2;
  if (attempts > 5) {
    console.log("Can't resolve main package.json file");
    return {
      targets: [],
      platforms: [process.platform],
      arches: [process.arch],
    };
  }
  try {
    const content = fs.readFileSync(
      path.join(__dirname, mainPath, 'package.json'),
      'utf-8'
    );
    const packageJson = JSON.parse(content);
    const opts = packageJson.iohook || packageJson.supportedTargets || {};
    if (!opts.targets) {
      opts.targets = [];
    }
    if (!opts.platforms) opts.platforms = [process.platform];
    if (!opts.arches) opts.arches = [process.arch];
    return opts;
  } catch (e) {
    let mainPath = Array(attempts).join('../');
    return optionsFromPackage(attempts + 1, mainPath);
  }
}

function printManualBuildParams() {
  const runtime = process.versions['electron'] ? 'electron' : 'node';
  const essential =
    runtime +
    '-v' +
    process.versions.modules +
    '-' +
    process.platform +
    '-' +
    process.arch;
  const modulePath = path.join(
    __dirname,
    'builds',
    essential,
    'build',
    'Release',
    'iohook.node'
  );
  console.info(
    `Runtime: ${runtime} ABI: ${process.versions.modules} Platform: ${process.platform} ARCH: ${process.arch}`
  );
  console.info('The path is:', modulePath);
}

module.exports = { optionsFromPackage, printManualBuildParams };
