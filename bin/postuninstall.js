#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.clitrigger');

if (fs.existsSync(CONFIG_DIR)) {
  console.log(`
CLITrigger가 제거되었습니다.

설정 및 데이터가 아래 경로에 남아 있습니다:
  ${CONFIG_DIR}

완전히 제거하려면 해당 폴더를 수동으로 삭제해주세요:
  rm -rf ${CONFIG_DIR}
`.trim());
}
