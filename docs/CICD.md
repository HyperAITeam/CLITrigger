# CLITrigger CI/CD 가이드

## 개요

CLITrigger는 **GitHub Actions** 기반 CI/CD 파이프라인을 사용합니다.

| 워크플로우 | 트리거 | 목적 |
|-----------|--------|------|
| **CI** (`ci.yml`) | `main` push / PR | 타입 체크, 테스트, 빌드 검증 |
| **Release** (`release.yml`) | `v*` 태그 push | 빌드 + GitHub Release 생성 |

---

## CI 워크플로우

### 파이프라인 구조

```
push/PR to main
       │
       ├─► typecheck ──────┐
       ├─► test-server ────┤
       └─► test-client ────┤
                           ▼
                        build (아티팩트 업로드)
```

**병렬 실행**: `typecheck`, `test-server`, `test-client`는 독립적으로 병렬 실행되어 빠른 피드백을 제공합니다. `build`는 세 job이 모두 성공한 후에만 실행됩니다.

**동시성 제어**: 같은 브랜치에서 새 push가 발생하면 진행 중인 이전 CI를 자동 취소합니다.

### 각 단계 상세

#### 1. Type Check (`typecheck`)
```bash
npm run typecheck:server   # tsc -p tsconfig.server.json --noEmit
npm run typecheck:client   # cd src/client && npx tsc --noEmit
```
서버와 클라이언트의 TypeScript 타입 오류를 빌드 없이 검증합니다.

#### 2. Server Tests (`test-server`)
```bash
npm run test:server   # vitest run --config vitest.config.ts
```
백엔드 52개 테스트 실행 (DB, 서비스, 미들웨어, WebSocket).

#### 3. Client Tests (`test-client`)
```bash
npm run test:client   # cd src/client && npx vitest run
```
프론트엔드 21개 테스트 실행 (API 클라이언트, 컴포넌트).

#### 4. Build (`build`)
```bash
npm run build   # 클라이언트(Vite) + 서버(tsc) 빌드
```
전체 프로덕션 빌드를 수행하고, `dist/` 아티팩트를 7일간 보관합니다.

---

## Release 워크플로우

### 릴리스 방법

```bash
# 1. 버전 태그 생성
git tag v1.0.0

# 2. 태그 push → 자동으로 Release 워크플로우 실행
git push origin v1.0.0
```

### 파이프라인 구조

```
v* 태그 push
     │
     ▼
 typecheck → test → build → package → GitHub Release
```

### 릴리스 산출물

- **GitHub Release**: 자동 생성 (release notes 자동 포함)
- **아티팩트**: `clitrigger-v{version}.tar.gz`
  - `dist/` — 컴파일된 서버 + 클라이언트 번들
  - `package.json`, `package-lock.json` — 의존성 정보
  - `.env.example` — 환경 변수 템플릿
  - `LICENSE` — 라이선스
  - `docs/` — 문서

### 릴리스 아티팩트로 배포하기

```bash
# 1. 릴리스 아티팩트 다운로드 & 압축 해제
tar -xzf clitrigger-v1.0.0.tar.gz

# 2. 프로덕션 의존성 설치
npm ci --production

# 3. 환경 설정
cp .env.example .env
# .env 편집

# 4. 실행
npm start
```

---

## 브랜치 전략

| 브랜치 | 용도 | CI 실행 |
|--------|------|---------|
| `main` | 안정 브랜치 (프로덕션 준비 상태) | push 시 |
| `feature/*` | 기능 개발 | PR 생성 시 |
| `fix/*` | 버그 수정 | PR 생성 시 |
| `v*` 태그 | 릴리스 | Release 워크플로우 |

### 권장 워크플로우

```
1. feature/my-feature 브랜치 생성
2. 개발 & 커밋
3. main으로 PR 생성 → CI 자동 실행
4. CI 통과 + 코드 리뷰 → 머지
5. 릴리스 시점에 v{version} 태그 push
```

---

## 로컬에서 CI 검증하기

PR을 올리기 전에 로컬에서 CI와 동일한 검증을 실행할 수 있습니다:

```bash
# 타입 체크
npm run typecheck

# 전체 테스트
npm test

# 빌드
npm run build
```

### 개별 실행

```bash
npm run typecheck:server    # 서버 타입 체크만
npm run typecheck:client    # 클라이언트 타입 체크만
npm run test:server         # 서버 테스트만
npm run test:client         # 클라이언트 테스트만
npm run test:coverage       # 커버리지 리포트 포함
```

---

## npm 스크립트 요약

| 스크립트 | 설명 | CI 사용 |
|----------|------|---------|
| `npm run typecheck` | 서버+클라이언트 타입 체크 | CI, Release |
| `npm run typecheck:server` | 서버 타입 체크 | CI |
| `npm run typecheck:client` | 클라이언트 타입 체크 | CI |
| `npm test` | 전체 테스트 | Release |
| `npm run test:server` | 서버 테스트 | CI |
| `npm run test:client` | 클라이언트 테스트 | CI |
| `npm run test:coverage` | 커버리지 리포트 | - |
| `npm run build` | 프로덕션 빌드 | CI, Release |

---

## 트러블슈팅

### CI에서 클라이언트 의존성 오류
클라이언트는 별도 `package.json`을 가지므로 `cd src/client && npm ci`가 필요합니다.
로컬에서 `src/client/package-lock.json`이 최신인지 확인하세요.

### 타입 체크 실패
```bash
npm run typecheck 2>&1 | head -50   # 오류 위치 확인
```

### 빌드 아티팩트 다운로드
GitHub Actions 탭 → 해당 워크플로우 실행 → Artifacts 섹션에서 `dist` 다운로드.
