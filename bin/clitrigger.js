#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline/promises';

const CONFIG_DIR = path.join(os.homedir(), '.clitrigger');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const MIGRATED_FLAG = path.join(CONFIG_DIR, '.password-migrated');

const args = process.argv.slice(2);

if (args[0] === 'config') {
  await handleConfig(args.slice(1));
} else if (args[0] === '--help' || args[0] === '-h') {
  printHelp();
} else {
  checkForUpdateAsync();
  await startServer();
}

async function startServer() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  // 첫 실행: 기본 config 생성 (비밀번호는 웹 첫 화면에서 설정)
  if (!fs.existsSync(CONFIG_FILE)) {
    const config = { port: 3000, tunnel: true };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Welcome to CLITrigger!');
    console.log(`Config created at ${CONFIG_FILE}`);
    console.log('Open the web UI to set your password on first launch.\n');
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  // Legacy plaintext cleanup: server has migrated to hashed credential, drop the
  // plaintext field from disk.
  if (fs.existsSync(MIGRATED_FLAG) && config.password) {
    delete config.password;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    try { fs.unlinkSync(MIGRATED_FLAG); } catch { /* ignore */ }
  }

  process.env.PORT = String(config.port || 3000);
  process.env.DB_PATH = path.join(CONFIG_DIR, 'clitrigger.db');
  // Pass legacy plaintext password through to the server one last time so it
  // can migrate to a scrypt hash. Removed from disk on the next launch.
  if (config.password) {
    process.env.AUTH_PASSWORD = config.password;
  }
  // tunnel defaults to true (auto-enable for new and existing users)
  if (config.tunnel !== false) {
    process.env.TUNNEL_ENABLED = 'true';
  }
  if (config.tunnelName) {
    process.env.TUNNEL_NAME = config.tunnelName;
  }
  if (config.tunnelHostname) {
    process.env.TUNNEL_HOSTNAME = config.tunnelHostname;
  }

  // 서버 시작
  await import('../dist/server/index.js');
}

async function handleConfig(args) {
  if (args[0] === 'clear') {
    if (!fs.existsSync(CONFIG_DIR)) {
      console.log('No config to delete.');
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`All config and data in ${CONFIG_DIR} will be deleted. Continue? (y/N) `);
    rl.close();
    if (answer.toLowerCase() === 'y') {
      fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
      console.log('Config and data deleted.');
    } else {
      console.log('Cancelled.');
    }
    return;
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('No config file found. Run clitrigger first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  if (args[0] === 'port') {
    if (!args[1]) {
      console.log(`Current port: ${config.port || 3000}`);
      return;
    }
    const port = parseInt(args[1], 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.log('Please enter a valid port number. (1-65535)');
      process.exit(1);
    }
    config.port = port;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`Port changed to ${port}.`);
  } else if (args[0] === 'password') {
    console.log('Password is now managed in the web UI.');
    console.log('  • First launch: open the browser and set a password on the setup screen.');
    console.log('  • Change later: open Settings → Account in the web UI.');
  } else if (args[0] === 'path') {
    console.log(CONFIG_DIR);
  } else if (args[0] === 'tunnel') {
    const summary = () => {
      const parts = [];
      if (config.tunnelName) parts.push(`name: ${config.tunnelName}`);
      if (config.tunnelHostname) parts.push(`hostname: ${config.tunnelHostname}`);
      return parts.length ? ` (${parts.join(', ')})` : '';
    };

    if (!args[1]) {
      console.log(`Tunnel: ${config.tunnel ? 'enabled' : 'disabled'}${summary()}`);
      return;
    }
    if (args[1] === 'on') {
      config.tunnel = true;
      if (args[2]) config.tunnelName = args[2];
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log(`Tunnel enabled.${summary()}`);
    } else if (args[1] === 'off') {
      config.tunnel = false;
      delete config.tunnelName;
      delete config.tunnelHostname;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log('Tunnel disabled.');
    } else if (args[1] === 'hostname') {
      if (!args[2]) {
        console.log(`Tunnel hostname: ${config.tunnelHostname || 'not set'}`);
        return;
      }
      if (args[2] === 'clear') {
        delete config.tunnelHostname;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('Tunnel hostname cleared.');
        return;
      }
      const hostname = args[2].trim().toLowerCase();
      if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)
        || hostname === 'localhost' || hostname === '127.0.0.1') {
        console.log('Please enter a valid public domain (e.g. app.your-domain.com).');
        process.exit(1);
      }
      config.tunnelHostname = hostname;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log(`Tunnel hostname set to ${hostname}.`);
    } else {
      console.log('Usage: clitrigger config tunnel [on [name] | off | hostname <host>|clear]');
    }
  } else {
    console.log(`Config (${CONFIG_FILE}):`);
    console.log(`  Port:     ${config.port || 3000}`);
    console.log(`  Password: managed in web UI (Settings → Account)`);
    console.log(`  Tunnel:   ${config.tunnel ? 'enabled' : 'disabled'}`);
    if (config.tunnelName)     console.log(`  Tunnel name:     ${config.tunnelName}`);
    if (config.tunnelHostname) console.log(`  Tunnel hostname: ${config.tunnelHostname}`);
  }
}

function isNewerVersion(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function checkForUpdateAsync() {
  (async () => {
    try {
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const currentVersion = pkg.version;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://registry.npmjs.org/clitrigger/latest', {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return;
      const data = await res.json();
      const latestVersion = data.version;

      if (!isNewerVersion(latestVersion, currentVersion)) return;

      console.log(`    Update available: ${latestVersion}  →  npm i -g clitrigger@latest`);
    } catch {
      // 네트워크 오류·타임아웃 — 조용히 무시
    }
  })();
}

function printHelp() {
  console.log(`
CLITrigger - AI-powered task execution tool

Usage:
  clitrigger                          Start the server (set password on first launch in browser)
  clitrigger config                   Show current config
  clitrigger config port <n>          Change port
  clitrigger config tunnel on         Enable Cloudflare tunnel
  clitrigger config tunnel on <name>  Enable named tunnel
  clitrigger config tunnel off        Disable tunnel
  clitrigger config tunnel hostname <host>
                                      Set custom domain for named tunnel
  clitrigger config tunnel hostname clear
                                      Clear custom domain
  clitrigger config path              Print config directory path
  clitrigger config clear             Delete all config and data
  clitrigger --help                   Show this help

Password is managed in the web UI (Settings → Account).
`.trim());
}
