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

    let password = '';
    while (!password) {
      password = await rl.question('비밀번호를 설정해주세요: ');
      if (!password) console.log('비밀번호는 필수입니다.');
    }
    rl.close();

    const config = { port: 3000, password };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`\n✅ 설정 완료! (${CONFIG_FILE})`);
  }

  // config 읽고 env 설정
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  // 기존 config에 비밀번호가 없으면 설정 강제
  if (!config.password) {
    console.log('⚠️  비밀번호가 설정되지 않았습니다.\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let password = '';
    while (!password) {
      password = await rl.question('비밀번호를 설정해주세요: ');
      if (!password) console.log('비밀번호는 필수입니다.');
    }
    rl.close();
    config.password = password;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('✅ 비밀번호가 설정되었습니다.\n');
  }

  process.env.PORT = String(config.port || 3000);
  process.env.AUTH_PASSWORD = config.password;
  process.env.DB_PATH = path.join(CONFIG_DIR, 'clitrigger.db');
  if (config.tunnel) {
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
      console.log('삭제할 설정이 없습니다.');
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`⚠️  ${CONFIG_DIR} 의 모든 설정과 데이터가 삭제됩니다. 계속하시겠습니까? (y/N) `);
    rl.close();
    if (answer.toLowerCase() === 'y') {
      fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
      console.log('✅ 설정 및 데이터가 삭제되었습니다.');
    } else {
      console.log('취소되었습니다.');
    }
    return;
  }

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
    let password = '';
    while (!password) {
      password = await rl.question('새 비밀번호: ');
      if (!password) console.log('비밀번호는 필수입니다.');
    }
    rl.close();
    config.password = password;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('✅ 비밀번호가 변경되었습니다.');
  } else if (args[0] === 'path') {
    console.log(CONFIG_DIR);
  } else if (args[0] === 'tunnel') {
    if (!args[1]) {
      console.log(`터널: ${config.tunnel ? '활성화' : '비활성화'}${config.tunnelName ? ` (이름: ${config.tunnelName})` : ''}`);
      return;
    }
    if (args[1] === 'on') {
      config.tunnel = true;
      if (args[2]) config.tunnelName = args[2];
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log(`✅ 터널이 활성화되었습니다.${config.tunnelName ? ` (이름: ${config.tunnelName})` : ''}`);
    } else if (args[1] === 'off') {
      config.tunnel = false;
      delete config.tunnelName;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log('✅ 터널이 비활성화되었습니다.');
    } else {
      console.log('사용법: clitrigger config tunnel [on [이름] | off]');
    }
  } else {
    console.log(`현재 설정 (${CONFIG_FILE}):`);
    console.log(`  포트: ${config.port || 3000}`);
    console.log(`  비밀번호: ${config.password ? '설정됨' : '없음'}`);
    console.log(`  터널: ${config.tunnel ? '활성화' : '비활성화'}${config.tunnelName ? ` (이름: ${config.tunnelName})` : ''}`);
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
  clitrigger config tunnel on   Cloudflare 터널 활성화
  clitrigger config tunnel on <name>  Named 터널 활성화
  clitrigger config tunnel off  터널 비활성화
  clitrigger config path        설정 디렉토리 경로 출력
  clitrigger config clear       설정 및 데이터 완전 삭제
  clitrigger --help             이 도움말 표시
`.trim());
}
