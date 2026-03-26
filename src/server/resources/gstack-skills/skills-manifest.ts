export interface GstackSkillMeta {
  id: string;
  name: string;
  description: string;
  descriptionKo: string;
  category: 'quality' | 'testing' | 'security' | 'debugging' | 'performance' | 'safety';
}

export const GSTACK_SKILLS: GstackSkillMeta[] = [
  {
    id: 'review',
    name: 'Code Review',
    description: 'Pre-merge code quality review with auto-fixes',
    descriptionKo: '머지 전 코드 품질 리뷰 및 자동 수정',
    category: 'quality',
  },
  {
    id: 'qa',
    name: 'QA Testing',
    description: 'Browser-based testing with automated bug fixes',
    descriptionKo: '브라우저 기반 테스트 및 자동 버그 수정',
    category: 'testing',
  },
  {
    id: 'qa-only',
    name: 'QA Report',
    description: 'QA reporting without code changes',
    descriptionKo: 'QA 리포트만 (코드 수정 없음)',
    category: 'testing',
  },
  {
    id: 'cso',
    name: 'Security Audit',
    description: 'OWASP Top 10 + STRIDE security scanning',
    descriptionKo: 'OWASP/STRIDE 보안 감사',
    category: 'security',
  },
  {
    id: 'investigate',
    name: 'Investigate',
    description: 'Systematic root-cause debugging',
    descriptionKo: '체계적 근본 원인 분석',
    category: 'debugging',
  },
  {
    id: 'benchmark',
    name: 'Benchmark',
    description: 'Performance regression detection (Core Web Vitals)',
    descriptionKo: '성능 회귀 감지 (Core Web Vitals)',
    category: 'performance',
  },
  {
    id: 'careful',
    name: 'Careful Mode',
    description: 'Destructive command warnings and safety guardrails',
    descriptionKo: '위험 명령어 경고 및 안전 가드레일',
    category: 'safety',
  },
];
