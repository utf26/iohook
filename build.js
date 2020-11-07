const spawn = require('child_process').spawn;
const fs = require('fs-extra');
const path = require('path');
const mkdirp = require('mkdirp');
const zlib = require('zlib');
const tar = require('tar');
const argv = require('minimist')(
    process.argv.slice(2), {
        // Specify that these arguments should be a string
        "string": ["version", "runtime", "abi"]
    }
);
const pkg = require('./package.json');

function mode(octal) {
  return parseInt(octal, 8)
}

let arch = process.env.ARCH
  ? process.env.ARCH
    .replace('i686', 'ia32')
    .replace('x86_64', 'x64')
  : process.arch;

let gypJsPath = path.join(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp'
);

let files = [];
let targets;
let chain = Promise.resolve();

initBuild();

function initBuild() {
	// Check if a specific runtime has been specified from the command line
	if ("runtime" in argv && "version" in argv && "abi" in argv) {
	    targets = [[argv["runtime"],
			argv["version"],
			argv["abi"]]];
	} else {
	    // If not, use those defined in package.json
	    targets = require('./package.json').supportedTargets;
	}

	targets.forEach(parts => {
	  let runtime = parts[0];
	  let version = parts[1];
	  let abi = parts[2]
	  chain = chain
	    .then(function () {
	      return build(runtime, version, abi)
	    })
	    .then(function () {
	      return tarGz(runtime, abi)
	    })
	    .catch(err => {
	      console.error(err);
	      process.exit(1);
	    })
	});

	chain = chain.then(function () {
	  if ("upload" in argv && argv["upload"] === 'false') {
	    // If no upload has been specified, don't attempt to upload
	    return;
	  }

	  return uploadFiles(files)
	});
	
	cpGyp();
}

function cpGyp() {
	try {
		fs.unlinkSync(path.join(__dirname, 'binding.gyp'));
		fs.unlinkSync(path.join(__dirname, 'uiohook.gyp'));
	} catch(e) {
	}
	switch (process.platform) {
		case 'win32':
		case 'darwin':
			fs.copySync(path.join(__dirname, 'build_def', process.platform, 'binding.gyp'), path.join(__dirname, 'binding.gyp'));
			fs.copySync(path.join(__dirname, 'build_def', process.platform, 'uiohook.gyp'), path.join(__dirname, 'uiohook.gyp'));
			break;
		default:
			fs.copySync(path.join(__dirname, 'build_def', 'linux', 'binding.gyp'), path.join(__dirname, 'binding.gyp'));
			fs.copySync(path.join(__dirname, 'build_def', 'linux', 'uiohook.gyp'), path.join(__dirname, 'uiohook.gyp'));
			break;
	}
}

function build(runtime, version, abi) {
  return new Promise(function (resolve, reject) {
	let args = [
		  'configure', 'rebuild',
		  '--target=' + version,
		  '--arch=' + arch
	];

    if (/^electron/i.test(runtime)) {
		args.push('--dist-url=https://atom.io/download/electron');
    }

    if (parseInt(abi) >= 80) {
	    if (arch === "x64") {
			args.push('--v8_enable_pointer_compression=1');
	    } else {
			args.push('--v8_enable_pointer_compression=0');
			args.push('--v8_enable_31bit_smis_on_64bit_arch=1');
	    }
    }
    if (process.platform !== "win32") {
	    if (parseInt(abi) >= 64) {
			args.push('--build_v8_with_gn=false');
	    }
	    if (parseInt(abi) >= 67) {
			args.push('--enable_lto=false');
	    }
    }

    console.log('Compiling iohook for ' + runtime + ' v' + version + '>>>>');
	if (process.platform === 'win32') {
		if (version.split('.')[0] >= 4) {
		  process.env.msvs_toolset = 15
		  process.env.msvs_version = 2017
		} else {
		  process.env.msvs_toolset = 12
		  process.env.msvs_version = 2013
		}
		args.push('--msvs_version=' + process.env.msvs_version);
	}
    let proc = spawn(gypJsPath, args, {
      env: process.env
    });
    proc.stdout.pipe(process.stdout);
    proc.stderr.pipe(process.stderr);
    proc.on('exit', function (code, sig) {
      if (code === 1) {
        return reject(new Error('Failed to build...'))
      }
      resolve()
    })
  })
}

function tarGz(runtime, abi) {
  const filesToArchive = process.platform == 'win32' ? 
    ['build/Release/iohook.node', 'build/Release/uiohook.dll']
  :
    ['build/Release/iohook.node']

  const tarPath = 'prebuilds/' + pkg.name + '-v' + pkg.version + '-' + runtime + '-v' + abi + '-' + process.platform + '-' + arch + '.tar.gz';

  files.push(tarPath)

  if (!fs.existsSync(path.dirname(tarPath))) {
	fs.mkdirSync(path.dirname(tarPath));
  }

  tar.c(
    {
      gzip: true,
      file: tarPath,
      sync: true,
    },
    filesToArchive,
  );

}

function uploadFiles (files) {
  const upload = require('prebuild/upload');
  return new Promise(function (resolve, reject) {
    console.log('Uploading ' + files.length + ' prebuilds(s) to Github releases');
    let opts = {
      pkg: pkg,
      files: files,
      upload: process.env.GITHUB_ACCESS_TOKEN
    };
    upload(opts, function (err, result) {
      if (err) {
        return reject(err);
      }
      console.log('Found ' + result.old.length + ' prebuild(s) on Github');
      if (result.old.length) {
        result.old.forEach(function (build) {
          console.log('-> ' + build)
        })
      }
      console.log('Uploaded ' + result.new.length + ' new prebuild(s) to Github');
      if (result.new.length) {
        result.new.forEach(function (build) {
          console.log('-> ' + build)
        })
      }
      resolve()
    })
  })
}
