#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline/promises';

const CONFIG_DIR = path.join(os.homedir(), '.clitrigger');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const args = process.argv.slice(2);

if (args[0] === 'config') {
  await handleConfig(args.slice(1));
} else if (args[0] === '--help' || args[0] === '-h') {
  printHelp();
} else {
  await startServer();
}

async function startServer() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  // 첫 실행: 초기 설정
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('Welcome to CLITrigger!\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const setPassword = await rl.question('비밀번호를 설정하시겠습니까? (y/N): ');
    let password = '';
    if (setPassword.toLowerCase() === 'y') {
      password = await rl.question('비밀번호: ');
    }
    rl.close();

    const config = { port: 3000, password };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`\n✅ 설정 완료! (${CONFIG_FILE})`);
  }

  // config 읽고 env 설정
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  process.env.PORT = String(config.port || 3000);
  if (config.password) process.env.AUTH_PASSWORD = config.password;
  process.env.DB_PATH = path.join(CONFIG_DIR, 'clitrigger.db');

  // 서버 시작
  await import('../dist/server/index.js');
}

async function handleConfig(args) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('설정 파일이 없습니다. clitrigger를 먼저 실행해주세요.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  if (args[0] === 'port') {
    if (!args[1]) {
      console.log(`현재 포트: ${config.port || 3000}`);
      return;
    }
    const port = parseInt(args[1], 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.log('유효한 포트 번호를 입력해주세요. (1-65535)');
      process.exit(1);
    }
    config.port = port;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`✅ 포트가 ${port}으로 변경되었습니다.`);
  } else if (args[0] === 'password') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const password = await rl.question('새 비밀번호 (빈 값 = 비밀번호 해제): ');
    rl.close();
    config.password = password;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    if (password) {
      console.log('✅ 비밀번호가 변경되었습니다.');
    } else {
      console.log('✅ 비밀번호가 해제되었습니다.');
    }
  } else if (args[0] === 'path') {
    console.log(CONFIG_DIR);
  } else {
    console.log(`현재 설정 (${CONFIG_FILE}):`);
    console.log(`  포트: ${config.port || 3000}`);
    console.log(`  비밀번호: ${config.password ? '설정됨' : '없음'}`);
  }
}

function printHelp() {
  console.log(`
CLITrigger - AI-powered task execution tool

Usage:
  clitrigger                    서버 시작
  clitrigger config             현재 설정 보기
  clitrigger config port <n>    포트 변경
  clitrigger config password    비밀번호 변경
  clitrigger config path        설정 디렉토리 경로 출력
  clitrigger --help             이 도움말 표시
`.trim());
}
