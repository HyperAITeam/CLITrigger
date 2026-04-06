# UI 테마 / 폰트 변경 용이성 분석 및 계획

## 현재 구조 분석

### 좋은 점 (테마 변경에 유리한 구조)

1. **Tailwind 커스텀 팔레트 집중화**
   - `tailwind.config.js`에 `warm`, `accent`, `status` 색상 팔레트가 한 곳에 정의되어 있음
   - 컴포넌트들이 `bg-warm-200`, `text-accent-gold` 등 시맨틱 토큰을 사용
   - 색상값을 직접 하드코딩한 경우가 거의 없음 → 팔레트만 바꾸면 전체 톤이 변경됨

2. **폰트 설정 집중화**
   - `tailwind.config.js`의 `fontFamily`와 `index.css`의 Google Fonts import 두 곳만 수정하면 폰트 변경 가능
   - `font-sans`, `font-mono` Tailwind 클래스로 참조

3. **공통 컴포넌트 클래스**
   - `index.css`의 `@layer components`에 `.card`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`, `.input-field`, `.badge` 등 공통 클래스 정의
   - UI 요소의 스타일이 한 곳에서 관리됨

4. **애니메이션/그림자도 config에 정의**
   - `boxShadow`, `animation`, `keyframes` 모두 `tailwind.config.js`에 토큰화

### 아쉬운 점 (테마 변경 시 주의 필요)

1. **CSS 변수 미사용**
   - CSS custom properties(`--color-primary` 등)를 거의 사용하지 않음 (1건만 발견)
   - 런타임 테마 전환(다크모드 토글 등)이 불가능 — Tailwind 빌드 타임에 값이 결정됨

2. **다크모드 미지원**
   - `dark:` 접두사 사용이 2건뿐 (GitStatusPanel의 일부)
   - `tailwind.config.js`에 `darkMode` 설정 없음

3. **인라인 스타일 30건**
   - `style={{}}` 사용이 16개 파일에 30건 존재 (ProgressBar, GitStatusPanel 등)
   - 이 부분은 테마 토큰 대신 직접 값이 들어가 있어 테마 변경 시 누락 가능

4. **`bg-white` 하드코딩**
   - `.card` 클래스에 `bg-white`가 있고, 컴포넌트에서도 직접 사용
   - 다크 테마 전환 시 전부 대응 필요

5. **Tailwind 클래스 554건 분산**
   - 30개 파일에 걸쳐 `bg-warm`, `text-warm` 등 554건 사용
   - 팔레트 이름 변경(예: `warm` → `neutral`) 시 전체 파일 수정 필요

---

## 테마 변경 방법

### 방법 1: Tailwind Config만 수정 (최소 변경, 즉시 적용 가능)

**범위**: 색상 톤, 폰트만 변경 / 다크모드 없음

**수정 파일 2개:**

| 파일 | 변경 내용 |
|------|----------|
| `src/client/tailwind.config.js` | `colors.warm` 팔레트 값 교체, `colors.accent` 값 교체, `fontFamily` 변경 |
| `src/client/src/index.css` | Google Fonts import URL 변경 |

**예시 — 쿨톤 블루 테마로 변경:**
```js
// tailwind.config.js
colors: {
  warm: {  // 이름은 유지하고 값만 변경
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    // ...slate 계열로 교체
  },
  accent: {
    gold: '#3B82F6',      // blue-500
    goldLight: '#60A5FA',  // blue-400
    goldDark: '#2563EB',   // blue-600
    amber: '#0EA5E9',      // sky-500
  },
}
```

**장점**: 작업량 최소, 기존 코드 수정 없음
**단점**: 시맨틱 이름(`warm`, `gold`)과 실제 색이 불일치, 런타임 전환 불가

---

### 방법 2: CSS 변수 기반 테마 시스템 도입 (다크모드 지원)

**범위**: 다크/라이트 모드 전환 + 커스텀 테마 지원

**작업 단계:**

#### Step 1: CSS 변수 정의 (`index.css`)
```css
:root {
  --color-bg-primary: #FBF8F3;
  --color-bg-secondary: #FEFDFB;
  --color-bg-card: #FFFFFF;
  --color-text-primary: #3D3629;
  --color-text-secondary: #5A4F3D;
  --color-text-muted: #A09178;
  --color-border: #E8E0D4;
  --color-accent: #D4A843;
  --color-accent-hover: #B08A2E;
  --color-accent-light: #E8C96A;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --radius-base: 0.75rem;
  --shadow-soft: 0 2px 8px rgba(0, 0, 0, 0.06);
}

[data-theme="dark"] {
  --color-bg-primary: #1A1A2E;
  --color-bg-secondary: #16213E;
  --color-bg-card: #0F3460;
  --color-text-primary: #E8E8E8;
  --color-text-secondary: #B0B0B0;
  --color-text-muted: #707070;
  --color-border: #2A2A4A;
  --color-accent: #E8C96A;
  --color-accent-hover: #D4A843;
  --color-accent-light: #F0D878;
  --shadow-soft: 0 2px 8px rgba(0, 0, 0, 0.3);
}
```

#### Step 2: Tailwind config에서 CSS 변수 참조
```js
// tailwind.config.js
colors: {
  theme: {
    bg: 'var(--color-bg-primary)',
    'bg-secondary': 'var(--color-bg-secondary)',
    card: 'var(--color-bg-card)',
    text: 'var(--color-text-primary)',
    'text-secondary': 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
    border: 'var(--color-border)',
    accent: 'var(--color-accent)',
    'accent-hover': 'var(--color-accent-hover)',
  },
}
```

#### Step 3: 컴포넌트 마이그레이션
- `bg-warm-100` → `bg-theme-bg`
- `text-warm-800` → `text-theme-text`
- `bg-white` → `bg-theme-card`
- `border-warm-200` → `border-theme-border`
- `bg-accent-gold` → `bg-theme-accent`

#### Step 4: 테마 전환 컨텍스트 추가
```tsx
// src/client/src/hooks/useTheme.ts
const ThemeContext = createContext<{theme: string; toggle: () => void}>();

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  return <ThemeContext.Provider value={{theme, toggle: () => setTheme(t => t === 'light' ? 'dark' : 'light')}}>{children}</ThemeContext.Provider>;
}
```

**작업량 추정:**
| 항목 | 파일 수 | 난이도 |
|------|---------|--------|
| CSS 변수 정의 | 1 | 낮음 |
| Tailwind config 수정 | 1 | 낮음 |
| 컴포넌트 클래스 마이그레이션 | ~30 | 중간 (반복 작업) |
| 인라인 스타일 수정 | ~16 | 중간 |
| 테마 전환 UI/Hook | 2-3 | 낮음 |
| `index.css` 공통 클래스 수정 | 1 | 낮음 |

---

### 방법 3: Tailwind v4 + CSS-first 마이그레이션 (장기)

Tailwind v4는 CSS 변수 기반이 기본이므로, v4 마이그레이션과 함께 테마 시스템을 도입하는 방법. 현재 프로젝트가 Tailwind v3을 사용 중이라면 v4 마이그레이션이 필요.

---

## 권장 전략

| 목표 | 권장 방법 |
|------|----------|
| 지금 당장 색상/폰트만 바꾸고 싶다 | **방법 1** (config 2파일 수정) |
| 다크모드 + 테마 전환이 필요하다 | **방법 2** (CSS 변수 도입) |
| 대규모 리팩토링 가능한 시점 | **방법 3** (Tailwind v4) |

**추천: 방법 1로 즉시 테마 변경 → 이후 방법 2로 점진적 마이그레이션**

방법 1은 `tailwind.config.js` + `index.css` 단 2개 파일 수정으로 전체 UI 톤을 변경할 수 있어 가장 효율적이다. 다크모드가 필요해질 때 방법 2로 확장하면 된다.

---

## 폰트 변경 Quick Guide

폰트만 바꾸려면 딱 2곳:

1. **`src/client/src/index.css` 1행** — Google Fonts import URL 변경
   ```css
   @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
   ```

2. **`src/client/tailwind.config.js` 34-37행** — fontFamily 변경
   ```js
   fontFamily: {
     sans: ['"Noto Sans KR"', 'system-ui', 'sans-serif'],
     mono: ['"D2Coding"', 'monospace'],
   },
   ```

끝. 빌드 후 전체 UI에 반영됨.
