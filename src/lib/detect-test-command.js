'use strict';
const fs = require('fs');
const path = require('path');

function detect(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      pkg = {};
    }
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    const testCmd = pkg.scripts && pkg.scripts.test ? 'npm test' : null;
    let watchCmd = null;
    if (deps.vitest) {
      watchCmd = 'npx vitest';
    } else if (deps.jest) {
      watchCmd = 'npx jest --watch';
    }
    return { stack: 'node', testCmd, watchCmd };
  }

  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return { stack: 'rust', testCmd: 'cargo test', watchCmd: 'cargo watch -x test' };
  }

  const hasMakefile = fs.existsSync(path.join(cwd, 'Makefile'));
  const hasPyproject = fs.existsSync(path.join(cwd, 'pyproject.toml'));
  if (hasMakefile || hasPyproject) {
    const testCmd = hasMakefile ? 'make test' : 'pytest';
    return { stack: 'python', testCmd, watchCmd: 'ptw' };
  }

  return { stack: 'unknown', testCmd: null, watchCmd: null };
}

module.exports = { detect };
