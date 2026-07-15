#!/usr/bin/env node
'use strict';
const { detect } = require('../src/lib/detect-test-command');
const cwd = process.argv[2] || process.cwd();
process.stdout.write(JSON.stringify(detect(cwd)));
