---
name: update-wiki
description: 오늘(또는 지정 날짜)의 git 커밋을 분석하여 GitHub Wiki(HyperAITeam/CLITrigger.wiki)를 업데이트합니다. 기존 페이지 뼈대는 유지하며 해당 섹션을 갱신하고, 완전히 새로운 기능이면 섹션/페이지를 추가합니다.
argument-hint: "[선택사항: 날짜 YYYY-MM-DD 또는 커밋 범위 hash1..hash2]"
---

# Wiki 업데이트

## 목적

특정 날짜(기본: 오늘)의 git 커밋을 분석하여 GitHub Wiki를 업데이트합니다:

- 위키 저장소: `https://github.com/HyperAITeam/CLITrigger.wiki.git`
- **기존 뼈대 우선**: 기능 개선이면 기존 페이지의 해당 섹션 본문을 갱신
- **신규는 추가**: 완전히 새로운 기능이면 매핑되는 페이지에 새 섹션을, 어느 페이지에도 안 맞으면 새 페이지를 추가
- **EN/KR 쌍 동기화**: 영문 페이지와 `-KR` 한국어 페이지를 항상 함께 갱신

위키는 사용자용 매뉴얼입니다. **사용자에게 보이는 기능만** 기록하고, 내부 리팩토링·빌드 설정·사소한 버그픽스는 쓰지 않습니다.

## 위키 구조 (뼈대)

| 영문 페이지 | 한국어 짝 | 다루는 내용 |
|------------|----------|------------|
| `Home.md` | `Home-KR.md` | 개요 + 각 페이지 링크 |
| `Plan-&-Organize.md` | `Plan-&-Organize-KR.md` | 내 일정, 플래너, 볼트(위키), Favorites |
| `Delegate-to-AI.md` | `Delegate-to-AI-KR.md` | 워크트리 병렬 실행, 세션(터미널/플로팅 창/팝아웃), 에이전트 토론, 스케줄, 멀티 CLI/샌드박스 |
| `Review-&-Ship.md` | `Review-&-Ship-KR.md` | Morning Review Queue, Git 클라이언트, Analytics, 라이브 로그 |
| `Remote-Access.md` | `Remote-Access-KR.md` | Cloudflare Tunnel, 알림, 커스텀 도메인 |

실제 페이지 목록은 클론 후 다시 확인합니다 (위 표에 없는 페이지가 있을 수 있음).

## 워크플로우

### Step 1: 위키 클론 준비

위키는 메인 저장소와 별도의 git 저장소입니다. 프로젝트의 **형제 디렉터리** `../CLITrigger.wiki`를 사용합니다:

```bash
# 이미 클론돼 있으면
git -C ../CLITrigger.wiki pull

# 없으면
git clone https://github.com/HyperAITeam/CLITrigger.wiki.git ../CLITrigger.wiki
```

클론 후 페이지 목록을 파악합니다: `*.md` 전체 + `_Sidebar.md`/`_Footer.md` 존재 여부.

### Step 2: 변경 내용 수집

인수를 파싱하여 대상 커밋 범위를 결정합니다 (update-docs와 동일):

- **인수 없음**: 오늘 날짜 (`git log --since="YYYY-MM-DDT00:00:00" --until="YYYY-MM-DDT23:59:59"`)
- **날짜 지정** (예: `2026-06-10`): 해당 날짜 커밋
- **커밋 범위** (예: `abc123..def456`): 해당 범위 커밋

대상 커밋이 0개이면 "해당 기간에 커밋이 없습니다." 출력 후 종료합니다.

**1차 소스 — changelog entry**: `docs/changelog/YYYY-MM/YYYY-MM-DD*.md`에 해당 날짜 entry가 이미 있으면 그것을 우선 사용합니다 (이미 큐레이션된 요약 + 배경 + 아키텍처 결정이 들어 있음). 없으면 커밋 메시지 전문 + 주요 diff를 직접 분석합니다.

제외 대상:

- 문서만 수정한 커밋
- 내부 리팩토링, 테스트, 빌드/CI 설정 (사용자 가시 동작이 안 바뀌는 것)
- WIP 커밋은 최종 결과 기준으로 통합

### Step 3: 뼈대 파악 + 매핑

1. `Home.md`(+`-KR`)와 변경이 매핑될 레이어 페이지(EN/KR 쌍)를 읽어 섹션 구조·헤딩(앵커)·톤을 파악합니다.
2. 각 변경을 페이지에 매핑합니다:
   - 세션/터미널/팝아웃/워크트리 실행/CLI/샌드박스 → `Delegate-to-AI`
   - 플래너/볼트/내 일정/Favorites → `Plan-&-Organize`
   - Git 클라이언트/리뷰 큐/Analytics/로그 → `Review-&-Ship`
   - 터널/알림/원격 → `Remote-Access`
3. 변경이 **기존 섹션의 개선**인지 **완전히 새로운 기능**인지 분류합니다.

### Step 4: 페이지 갱신

#### 4a. 기존 기능의 개선 (기본)

- 해당 페이지의 **기존 섹션 본문을 갱신**합니다 (새 동작 설명 추가, 달라진 부분 교체).
- **기존 헤딩(섹션 제목)은 절대 rename 금지** — `README.md`/`README_KR.md`가 위키 앵커로 딥링크하고 있어 (예: `Delegate-to-AI#interactive-sessions`) 헤딩이 바뀌면 링크가 깨집니다. 섹션 삭제도 금지. 추가/본문 수정만 합니다.

#### 4b. 완전히 새로운 기능

- 매핑되는 레이어 페이지에 새 `##`/`###` 섹션을 기존 섹션들과 같은 형식·상세도로 추가합니다.
- 어느 레이어에도 맞지 않으면 새 페이지(EN + `-KR` 쌍)를 만들고 `Home.md`/`Home-KR.md`에 링크를 추가합니다. `_Sidebar.md`가 존재하면 거기에도 추가합니다.

#### 4c. EN/KR 쌍 동기화 (필수)

- 영문 페이지를 고치면 **같은 내용을 `-KR` 페이지에 한국어로** 반영합니다. 한쪽만 고치고 끝내지 않습니다.
- 영문은 영문 페이지의 기존 톤, 한국어는 KR 페이지의 기존 톤을 따릅니다 (직역체 금지, 기존 문체 모방).

**주의사항**:

- 위키는 매뉴얼이지 changelog가 아닙니다 — "X가 추가되었습니다" 식의 이력 서술이 아니라, **현재 동작 기준**으로 사용법을 서술합니다.
- 커밋 해시·날짜·내부 파일 경로를 본문에 넣지 않습니다.
- 스크린샷 추가는 하지 않습니다 (이미지 업로드는 수동 작업).

### Step 5: 커밋 & 푸시

위키 저장소(`../CLITrigger.wiki`)에서:

```bash
git add -A
git commit -m "docs: <갱신 내용 한 줄 요약 (한국어)>"
git push
```

푸시가 실패하면 (인증 등) 커밋은 그대로 두고, 사용자에게 `../CLITrigger.wiki`에서 수동으로 `git push` 하라고 안내합니다.

### Step 6: 결과 요약

```markdown
## Wiki 업데이트 완료

**대상**: YYYY-MM-DD 커밋 N개 (changelog entry M개 활용)

| 페이지 | 변경 |
|--------|------|
| `Delegate-to-AI` + `-KR` | "Interactive Sessions" 섹션 갱신: ... |
| `Home` + `-KR` | 새 페이지 링크 추가 |

푸시: 완료 (또는 실패 사유 + 수동 푸시 안내)
```

## 예외사항

다음은 **문제가 아닙니다**:

1. **WIP/temp/fixup 커밋** — 최종 결과 기준으로 통합하여 문서화
2. **위키에 쓸 내용이 없는 날** (전부 내부 변경/문서 커밋) — "위키에 반영할 사용자 가시 변경이 없습니다." 출력 후 종료 (클론/푸시도 생략)
3. **커밋 메시지가 불충분한 경우** — diff를 직접 분석
4. **위 표에 없는 위키 페이지 발견** — 런타임 페이지 목록 기준으로 매핑 판단

## Related Files

| File | Purpose |
|------|---------|
| `../CLITrigger.wiki/*.md` | 위키 페이지 (EN + `-KR` 쌍) |
| `docs/changelog/YYYY-MM/*.md` | 변경 요약 1차 소스 (있을 때) |
| `README.md` / `README_KR.md` | 위키 앵커 딥링크 — 헤딩 rename 금지의 근거 |
| `.claude/skills/update-docs/SKILL.md` | 자매 스킬 (changelog/SETUP.md 담당) |
