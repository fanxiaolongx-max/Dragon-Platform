#!/usr/bin/env node
/**
 * Wrapper script to launch welink-cli.exe
 * This allows npm bin linking when the exe is bundled
 */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Find welink-cli.exe dynamically
function findExe() {
    const possibleExePaths = [
        // Bundled in npm package root (most common for published packages)
        path.resolve(__dirname, '..', 'welink-cli.exe'),
        // Development build locations
        path.resolve(__dirname, '..', 'build', 'Release', 'welink-cli.exe'),
        path.resolve(__dirname, '..', 'build', 'Debug', 'welink-cli.exe'),
        // Bundled in npm package bin directory
        path.resolve(__dirname, '..', 'bin', 'welink-cli.exe'),
        // Platform-specific prebuilt
        path.resolve(__dirname, '..', 'prebuilds', `win32-${process.arch}`, 'welink-cli.exe'),
        path.resolve(__dirname, '..', 'vendor', 'welink-cli.exe'),
    ];

    for (const p of possibleExePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}

const exePath = findExe();

if (!exePath) {
    console.error('Error: welink-cli.exe not found.');
    console.error('Please build the CLI first:');
    console.error('  1. conan install . --build=missing -s:h compiler.runtime=static');
    console.error('  2. cmake --preset conan-release');
    console.error('  3. cmake --build build --config Release');
    process.exit(1);
}

// Spawn the exe with all arguments
const child = spawn(exePath, process.argv.slice(2), {
    stdio: 'inherit',
    shell: false
});

child.on('exit', (code) => {
    process.exit(code || 0);
});