# Changelog

## 2026-03-26 — gstack 스킬 통합

### 배경

[gstack](https://github.com/garrytan/gstack) (MIT License, Garry Tan)은 Claude Code용 28개 AI 스킬을 제공하는 오픈소스 프로젝트이다. CLITrigger가 TODO를 실행할 때 이 스킬들을 worktree에 자동 주입하면, Claude CLI의 작업 품질을 높일 수 있다.

### 구현 내용

gstack의 28개 스킬 중 자동화 실행에 적합한 **7개 스킬**을 선별하여 CLITrigger에 번들링하고, 프로젝트 설정에서 ON/OFF + 개별 선택이 가능하도록 구현했다.

#### 선별 스킬

- `review` — 코드 리뷰 & 자동 수정 (9/10)
- `qa` — 브라우저 기반 QA 테스트 (9/10)
- `qa-only` — QA 리포트만 (10/10)
- `cso` — OWASP/STRIDE 보안 감사 (9/10)
- `investigate` — 체계적 디버깅 (8/10)
- `benchmark` — 성능 회귀 감지 (10/10)
- `careful` — 위험 명령어 경고 (10/10)

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/resources/gstack-skills/` | 7개 스킬 SKILL.md 파일 + LICENSE + 매니페스트 |
| `src/server/services/skill-injector.ts` | 스킬 파싱, 조회, worktree 주입 서비스 |
| `src/client/src/api/gstack.ts` | 프론트엔드 gstack API 클라이언트 |
| `THIRD_PARTY_LICENSES.md` | 서드파티 라이선스 고지 |
| `docs/CHANGELOG.md` | 이 파일 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `gstack_enabled`, `gstack_skills` 컬럼 마이그레이션 추가 |
| `src/server/db/queries.ts` | `Project` 인터페이스 및 `updateProject`에 gstack 필드 추가 |
| `src/server/services/orchestrator.ts` | `startSingleTodo()`에서 worktree 생성 후 CLI spawn 전에 스킬 주입 호출 |
| `src/server/routes/projects.ts` | PUT 업데이트에 gstack 필드 처리 + `gstackRouter` 분리 (`GET /api/gstack/skills`) |
| `src/server/index.ts` | `gstackRouter`를 `/api/gstack`에 마운트 |
| `src/client/src/types.ts` | `Project`에 gstack 필드 + `GstackSkill` 인터페이스 추가 |
| `src/client/src/api/projects.ts` | `updateProject` 파라미터에 gstack 필드 추가 |
| `src/client/src/components/ProjectHeader.tsx` | 설정 패널에 gstack 토글 + 스킬 체크박스 UI 추가 |
| `src/client/src/i18n.tsx` | 한/영 gstack 관련 번역 키 추가 |
| `package.json` | `build:server`에 리소스 복사 (`cp -r`) 추가 |
| `docs/SETUP.md` | gstack 스킬 사용법 섹션 + API 테이블에 엔드포인트 추가 |

#### 아키텍처 결정

1. **스킬 격리**: gstack 스킬은 worktree의 `.claude/skills/gstack-{id}/SKILL.md`에 배치되어 기존 스킬과 충돌하지 않음
2. **Claude CLI 전용**: `cliTool === 'claude'`일 때만 주입 (Gemini/Codex는 gstack 스킬 미지원)
3. **실패 허용**: 스킬 주입 실패 시 로그만 남기고 CLI 실행은 계속 진행
4. **DB 저장**: `gstack_enabled` (INTEGER 0/1) + `gstack_skills` (JSON 배열 문자열)로 프로젝트별 설정 저장

#### 검증

- TypeScript 서버 컴파일: 통과
- 기존 테스트 52개: 전체 통과
- MIT 라이선스 고지: `THIRD_PARTY_LICENSES.md` + UI 크레딧 + 리소스 내 LICENSE 파일
