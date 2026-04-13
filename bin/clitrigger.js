#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline/promises';
import { execSync, spawn } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.clitrigger');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const args = process.argv.slice(2);

if (args[0] === 'config') {
  await handleConfig(args.slice(1));
} else if (args[0] === '--help' || args[0] === '-h') {
  printHelp();
} else {
  const updated = await checkAutoUpdate();
  if (!updated) {
    await startServer();
  }
}

async function startServer() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  // 첫 실행: 초기 설정
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('Welcome to CLITrigger!\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    let password = '';
    while (!password) {
      password = await rl.question('Set a password: ');
      if (!password) console.log('Password is required.');
    }
    rl.close();

    const config = { port: 3000, password, tunnel: true };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`\nSetup complete! (${CONFIG_FILE})`);
  }

  // config 읽고 env 설정
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  // 기존 config에 비밀번호가 없으면 설정 강제
  if (!config.password) {
    console.log('Password is not set.\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let password = '';
    while (!password) {
      password = await rl.question('Set a password: ');
      if (!password) console.log('Password is required.');
    }
    rl.close();
    config.password = password;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Password saved.\n');
  }

  process.env.PORT = String(config.port || 3000);
  process.env.AUTH_PASSWORD = config.password;
  process.env.DB_PATH = path.join(CONFIG_DIR, 'clitrigger.db');
  // tunnel defaults to true (auto-enable for new and existing users)
  if (config.tunnel !== false) {
    process.env.TUNNEL_ENABLED = 'true';
  }
  if (config.tunnelName) {
    process.env.TUNNEL_NAME = config.tunnelName;
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
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let password = '';
    while (!password) {
      password = await rl.question('New password: ');
      if (!password) console.log('Password is required.');
    }
    rl.close();
    config.password = password;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Password changed.');
  } else if (args[0] === 'path') {
    console.log(CONFIG_DIR);
  } else if (args[0] === 'tunnel') {
    if (!args[1]) {
      console.log(`Tunnel: ${config.tunnel ? 'enabled' : 'disabled'}${config.tunnelName ? ` (name: ${config.tunnelName})` : ''}`);
      return;
    }
    if (args[1] === 'on') {
      config.tunnel = true;
      if (args[2]) config.tunnelName = args[2];
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log(`Tunnel enabled.${config.tunnelName ? ` (name: ${config.tunnelName})` : ''}`);
    } else if (args[1] === 'off') {
      config.tunnel = false;
      delete config.tunnelName;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log('Tunnel disabled.');
    } else {
      console.log('Usage: clitrigger config tunnel [on [name] | off]');
    }
  } else {
    console.log(`Config (${CONFIG_FILE}):`);
    console.log(`  Port:     ${config.port || 3000}`);
    console.log(`  Password: ${config.password ? 'set' : 'not set'}`);
    console.log(`  Tunnel:   ${config.tunnel ? 'enabled' : 'disabled'}${config.tunnelName ? ` (name: ${config.tunnelName})` : ''}`);
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

async function checkAutoUpdate() {
  // 업데이트 직후 재시작된 프로세스면 스킵
  if (process.env.CLITRIGGER_UPDATED === '1') {
    delete process.env.CLITRIGGER_UPDATED;
    return false;
  }

  try {
    if (!fs.existsSync(CONFIG_FILE)) return false;

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

    // 24시간 이내에 체크했으면 스킵
    const now = Date.now();
    const lastCheck = config.lastUpdateCheck || 0;
    if (now - lastCheck < 24 * 60 * 60 * 1000) return false;

    // 체크 시간 저장 (네트워크 실패 시에도 반복 체크 방지)
    config.lastUpdateCheck = now;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // 현재 버전 읽기
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const currentVersion = pkg.version;

    // npm registry에서 최신 버전 조회 (5초 타임아웃)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://registry.npmjs.org/clitrigger/latest', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;
    const data = await res.json();
    const latestVersion = data.version;

    if (!isNewerVersion(latestVersion, currentVersion)) return false;

    console.log(`\nUpdate available: v${currentVersion} -> v${latestVersion}, updating...`);
    execSync('npm i -g clitrigger@latest', { stdio: 'inherit' });
    console.log(`Updated to v${latestVersion}. Restarting...\n`);

    // 업데이트된 코드로 재시작
    const child = spawn(process.argv[0], process.argv.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, CLITRIGGER_UPDATED: '1' },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return true;
  } catch {
    // 네트워크 오류, 타임아웃 등 — 무시하고 현재 버전으로 계속
    return false;
  }
}

function printHelp() {
  console.log(`
CLITrigger - AI-powered task execution tool

Usage:
  clitrigger                          Start the server
  clitrigger config                   Show current config
  clitrigger config port <n>          Change port
  clitrigger config password          Change password
  clitrigger config tunnel on         Enable Cloudflare tunnel
  clitrigger config tunnel on <name>  Enable named tunnel
  clitrigger config tunnel off        Disable tunnel
  clitrigger config path              Print config directory path
  clitrigger config clear             Delete all config and data
  clitrigger --help                   Show this help
`.trim());
}
