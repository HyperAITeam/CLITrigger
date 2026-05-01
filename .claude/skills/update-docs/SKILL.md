---
name: update-docs
description: 오늘(또는 지정 날짜)의 git 커밋을 분석하여 docs/changelog/, SETUP.md, CLAUDE.md 문서를 자동 업데이트합니다.
argument-hint: "[선택사항: 날짜 YYYY-MM-DD 또는 커밋 범위 hash1..hash2]"
---

# 문서 업데이트

## 목적

특정 날짜(기본: 오늘)의 git 커밋을 분석하여 프로젝트 문서 3종을 일관되게 업데이트합니다:

- `docs/changelog/YYYY-MM/YYYY-MM-DD.md` — 해당 날짜 변경 이력 파일 신규 생성 (또는 같은 날 추가 항목이면 `-2`/`-3` suffix)
- `docs/changelog/README.md` — 인덱스에 한 줄 추가
- `docs/SETUP.md` — 사용법/API 테이블 반영
- `CLAUDE.md` — 아키텍처 설명 반영

## 워크플로우

### Step 1: 대상 커밋 수집

인수를 파싱하여 대상 커밋 범위를 결정합니다:

- **인수 없음**: 오늘 날짜 (`git log --since="YYYY-MM-DDT00:00:00" --until="YYYY-MM-DDT23:59:59"`)
- **날짜 지정** (예: `2026-04-03`): 해당 날짜 커밋
- **커밋 범위** (예: `abc123..def456`): 해당 범위 커밋

대상 커밋이 0개이면:

```markdown
## 문서 업데이트

해당 기간에 커밋이 없습니다.
```

종료합니다.

### Step 2: 변경 분석

각 커밋에 대해 다음을 수집합니다:

1. `git log <hash> -1 --format="%B"` — 커밋 메시지 전문
2. `git diff <hash>^..<hash> --stat` — 변경 파일 목록
3. `git diff <hash>^..<hash>` — 주요 파일의 실제 diff (서버 서비스, DB 스키마, 라우트, 클라이언트 컴포넌트 중심)

수집한 정보를 바탕으로 다음을 파악합니다:

- **기능 추가**: 새 파일, 새 API 엔드포인트, 새 UI 컴포넌트
- **아키텍처 변경**: 서비스 역할 변경, 새 패턴 도입, DB 스키마 변경
- **사용법 변경**: 새 설정 옵션, 새 사용자 기능, UI 흐름 변경

### Step 3: 현재 문서 읽기

다음 파일을 읽습니다:

1. `docs/changelog/README.md` — 인덱스 형식과 가장 최근 entry의 월/파일명 패턴 파악
2. 직전 entry 파일 1-2개 (예: `docs/changelog/YYYY-MM/YYYY-MM-DD.md`) — 본문 스타일과 톤 파악
3. `docs/SETUP.md` — 섹션 번호, API 테이블 위치 파악
4. `CLAUDE.md` — Architecture 섹션의 현재 내용 파악

### Step 4: 날짜별 changelog 파일 생성 + 인덱스 갱신

#### 4a. 파일 경로 결정

- 대상 날짜가 `YYYY-MM-DD`이면 폴더는 `docs/changelog/YYYY-MM/`
- 해당 폴더가 없으면 신규 생성
- 파일명:
  - 같은 날 첫 번째 항목: `YYYY-MM-DD.md`
  - 같은 날 두 번째 이후 항목 (이미 `YYYY-MM-DD.md`가 있는 경우): 기존 파일을 `YYYY-MM-DD-1.md`로 rename 후 새 파일을 `YYYY-MM-DD-2.md`로 생성. 이미 `-1`, `-2` 패턴이면 다음 번호로 이어감.

#### 4b. 파일 본문 (기존 entry 스타일 그대로)

```markdown
## YYYY-MM-DD — 한줄 요약 제목

### 배경

왜 이 변경이 필요했는지 1-2문장.

### 주요 변경

#### 1. 기능/변경 이름 (`커밋해시`)

- 변경 내용 bullet points
- **서버**: 서버 측 변경
- **클라이언트**: 클라이언트 측 변경
- **DB**: 스키마 변경
- **i18n**: 번역 키 추가

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `path/to/file.ts` | 변경 설명 |

### 아키텍처 결정

1. **결정 이름**: 왜 이렇게 했는지
```

#### 4c. 인덱스 갱신 (`docs/changelog/README.md`)

- 해당 월(`## YYYY-MM`) 섹션의 **최상단**에 한 줄 추가:
  ```
  - [YYYY-MM-DD — 제목](./YYYY-MM/YYYY-MM-DD.md)
  ```
- 해당 월 섹션이 아직 없으면, 적절한 위치(최신 월이 위에 오도록)에 새 `## YYYY-MM` 헤더와 함께 추가
- 같은 날 항목이 여러 개라 파일이 `-1`/`-2` 형태면 링크도 그에 맞춰 작성

**주의사항**:
- 커밋 메시지의 상세 설명이 있으면 그대로 활용
- 같은 날 커밋이라도 주제가 명확히 다르면 별도 entry 파일로 나누기 (예: GitHub 통합 vs Notion 통합)
- 주제가 같으면 한 entry 파일에 묶기
- 기존 entry와 동일한 한국어 톤/스타일 유지
- 파일 끝에 trailing newline 1개 유지 (기존 파일과 동일)

### Step 5: SETUP.md 업데이트

변경 내용에 따라 필요한 섹션만 업데이트합니다:

#### 5a. 새 사용자 기능이 추가된 경우

- 적절한 위치에 새 섹션 추가 (번호 순서 유지)
- 뒤따르는 섹션 번호 자동 조정
- 설정 방법, 사용법, 주의사항 포함

#### 5b. 새 API 엔드포인트가 추가된 경우

- `## API 요약` 테이블에 새 행 추가
- 기존 엔드포인트 그룹 근처에 배치 (예: git 관련은 git 엔드포인트 근처)

#### 5c. 환경 변수가 추가된 경우

- `## 2단계: 환경 설정` 섹션의 `.env` 예시에 추가

#### 5d. DB 컬럼만 추가되고 사용자 기능이 없는 경우

- SETUP.md는 수정하지 않음

### Step 6: CLAUDE.md 업데이트

Architecture 섹션의 해당 항목 설명을 업데이트합니다:

- **서비스 역할 변경**: `Services` 목록의 해당 서비스 설명 수정
- **새 패턴 도입**: `Key Patterns` 목록에 항목 추가
- **새 컴포넌트/라우트**: `Components`, `Routes` 설명 업데이트
- **DB 테이블 변경**: `Database` 설명의 테이블 카운트/목록 업데이트

**주의사항**:
- CLAUDE.md는 영어로 작성
- 기존 bullet point 스타일과 상세도 수준 유지
- 불필요한 정보 추가 금지 (예: 커밋 해시, 날짜 등)

### Step 7: 결과 요약

모든 업데이트 완료 후 요약을 출력합니다:

```markdown
## 문서 업데이트 완료

**대상**: YYYY-MM-DD 커밋 N개

| 문서 | 변경 |
|------|------|
| `docs/changelog/YYYY-MM/YYYY-MM-DD.md` | 신규 entry 파일 생성: "제목" |
| `docs/changelog/README.md` | 인덱스에 한 줄 추가 |
| `docs/SETUP.md` | 섹션 X 추가, API 테이블 Y개 행 추가 |
| `CLAUDE.md` | Architecture 섹션 Z개 항목 업데이트 |
```

## 예외사항

다음은 **문제가 아닙니다**:

1. **WIP/temp/fixup 커밋** — 이런 커밋은 최종 결과 기준으로 통합하여 문서화 (중간 과정은 무시)
2. **문서만 수정한 커밋** — CHANGELOG에 기록하지 않음 (문서 수정은 문서화할 필요 없음)
3. **커밋 메시지가 불충분한 경우** — diff를 직접 분석하여 변경 내용 파악
4. **SETUP.md 섹션 번호 불연속** — 새 섹션 추가 시 뒤따르는 번호를 자동 조정

## Related Files

| File | Purpose |
|------|---------|
| `docs/changelog/README.md` | 인덱스 (월별 섹션 + 날짜별 entry 링크) |
| `docs/changelog/YYYY-MM/YYYY-MM-DD.md` | 날짜별 entry 본문 |
| `docs/SETUP.md` | 설치/사용법 가이드 (섹션 번호 + API 테이블) |
| `CLAUDE.md` | 프로젝트 아키텍처 설명 (영어) |
