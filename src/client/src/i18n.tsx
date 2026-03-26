import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'en' | 'ko';

const translations = {
  en: {
    // Login
    'login.title': 'CLITrigger',
    'login.subtitle': 'Authentication Required',
    'login.password': 'Enter password',
    'login.submit': 'Sign In',
    'login.loading': 'Authenticating...',
    'login.error': 'Access denied. Please try again.',
    'login.footer': 'Secure Access',

    // Project List
    'projects.title': 'CLITrigger',
    'projects.subtitle': 'Project Console',
    'projects.new': 'New Project',
    'projects.logout': 'Sign Out',
    'projects.loading': 'Loading projects...',
    'projects.empty': 'No projects yet',
    'projects.emptyHint': 'Create your first project to get started.',
    'projects.tasks': 'tasks',
    'projects.active': 'active',
    'projects.done': 'done',
    'projects.delete': 'Delete project',
    'projects.noGit': 'No Git',

    // Project Detail
    'detail.back': 'Projects',
    'detail.loading': 'Loading...',
    'detail.notFound': 'Project not found',
    'detail.backToProjects': 'Back to Projects',
    'detail.live': 'Connected',

    // Project Header
    'header.branch': 'Branch',
    'header.workers': 'Workers',
    'header.model': 'Model',
    'header.settings': 'Settings',
    'header.runAll': 'Run All',
    'header.stopAll': 'Stop All',
    'header.config': 'Project Settings',
    'header.maxWorkers': 'Max Workers',
    'header.claudeModel': 'Claude Model',
    'header.cliFlags': 'CLI Flags',
    'header.cancel': 'Cancel',
    'header.save': 'Save',
    'header.saving': 'Saving...',
    'header.noGit': 'No Git',
    'header.noGitHint': 'This project is not a git repository. Tasks will run directly without worktree isolation. Run "git init" in the project path, then re-check.',
    'header.recheckGit': 'Re-check Git Status',

    // Project Form
    'form.newProject': 'New Project',
    'form.projectName': 'Project Name',
    'form.folderPath': 'Folder Path',
    'form.cancel': 'Cancel',
    'form.create': 'Create',

    // Todo List
    'todos.title': 'Tasks',
    'todos.add': 'Add Task',
    'todos.empty': 'No tasks yet',
    'todos.emptyHint': 'Add a task to begin.',

    // Todo Item
    'todo.description': 'Description',
    'todo.noDescription': 'No description provided.',
    'todo.branch': 'Branch',
    'todo.path': 'Path',
    'todo.mergeFailed': 'Merge failed',
    'todo.diffError': 'Diff error',
    'todo.diffOutput': 'Changes',
    'todo.files': 'files',
    'todo.systemLog': 'Activity Log',
    'todo.start': 'Start',
    'todo.startHeadless': 'Headless: Runs autonomously with -p flag. All permissions auto-approved (--dangerously-skip-permissions). No user input needed.',
    'todo.startStreaming': 'Streaming: Sends prompt via stdin then runs autonomously. All permissions auto-approved. Good for long prompts with special characters.',
    'todo.startInteractive': 'Interactive: Keeps stdin open so you can send messages to Claude during execution. All permissions auto-approved.',
    'todo.sendPlaceholder': 'Type a message to Claude...',
    'todo.stop': 'Stop',
    'todo.viewDiff': 'View Diff',
    'todo.merge': 'Merge',
    'todo.edit': 'Edit',
    'todo.delete': 'Delete',
    'todo.cleanup': 'Clean up worktree',
    'todo.cleanupFailed': 'Cleanup failed',

    // Todo Form
    'todoForm.titlePlaceholder': 'Task title...',
    'todoForm.descPlaceholder': 'Description (optional)...',
    'todoForm.cancel': 'Cancel',
    'todoForm.save': 'Save',

    // Status
    'status.pending': 'Idle',
    'status.running': 'Running',
    'status.completed': 'Done',
    'status.failed': 'Failed',
    'status.stopped': 'Stopped',
    'status.merged': 'Merged',

    // Progress
    'progress.complete': 'complete',
    'progress.done': 'Done',
    'progress.live': 'Running',
    'progress.idle': 'Idle',
    'progress.fail': 'Failed',
    'progress.stop': 'Stopped',
    'progress.merged': 'Merged',

    // Log
    'log.awaiting': 'Awaiting output...',
    'log.noChanges': 'No changes detected.',

    // Language
    'lang.toggle': 'KO',
  },
  ko: {
    // Login
    'login.title': 'CLITrigger',
    'login.subtitle': '\uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4',
    'login.password': '\uBE44\uBC00\uBC88\uD638 \uC785\uB825',
    'login.submit': '\uB85C\uADF8\uC778',
    'login.loading': '\uC778\uC99D \uC911...',
    'login.error': '\uC811\uADFC\uC774 \uAC70\uBD80\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694.',
    'login.footer': '\uBCF4\uC548 \uC811\uC18D',

    // Project List
    'projects.title': 'CLITrigger',
    'projects.subtitle': '\uD504\uB85C\uC81D\uD2B8 \uCF58\uC194',
    'projects.new': '\uC0C8 \uD504\uB85C\uC81D\uD2B8',
    'projects.logout': '\uB85C\uADF8\uC544\uC6C3',
    'projects.loading': '\uD504\uB85C\uC81D\uD2B8 \uB85C\uB529 \uC911...',
    'projects.empty': '\uD504\uB85C\uC81D\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4',
    'projects.emptyHint': '\uCCAB \uBC88\uC9F8 \uD504\uB85C\uC81D\uD2B8\uB97C \uB9CC\uB4E4\uC5B4\uBCF4\uC138\uC694.',
    'projects.tasks': '\uC791\uC5C5',
    'projects.active': '\uC2E4\uD589 \uC911',
    'projects.done': '\uC644\uB8CC',
    'projects.delete': '\uD504\uB85C\uC81D\uD2B8 \uC0AD\uC81C',
    'projects.noGit': 'Git \uC5C6\uC74C',

    // Project Detail
    'detail.back': '\uD504\uB85C\uC81D\uD2B8',
    'detail.loading': '\uB85C\uB529 \uC911...',
    'detail.notFound': '\uD504\uB85C\uC81D\uD2B8\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4',
    'detail.backToProjects': '\uD504\uB85C\uC81D\uD2B8 \uBAA9\uB85D\uC73C\uB85C',
    'detail.live': '\uC5F0\uACB0\uB428',

    // Project Header
    'header.branch': '\uBE0C\uB79C\uCE58',
    'header.workers': '\uC6CC\uCEE4',
    'header.model': '\uBAA8\uB378',
    'header.settings': '\uC124\uC815',
    'header.runAll': '\uC804\uCCB4 \uC2E4\uD589',
    'header.stopAll': '\uC804\uCCB4 \uC911\uC9C0',
    'header.config': '\uD504\uB85C\uC81D\uD2B8 \uC124\uC815',
    'header.maxWorkers': '\uCD5C\uB300 \uC6CC\uCEE4 \uC218',
    'header.claudeModel': 'Claude \uBAA8\uB378',
    'header.cliFlags': 'CLI \uD50C\uB798\uADF8',
    'header.cancel': '\uCDE8\uC18C',
    'header.save': '\uC800\uC7A5',
    'header.saving': '\uC800\uC7A5 \uC911...',
    'header.noGit': 'Git \uC5C6\uC74C',
    'header.noGitHint': '\uC774 \uD504\uB85C\uC81D\uD2B8\uB294 Git \uC800\uC7A5\uC18C\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uC791\uC5C5\uC740 \uC6CC\uD06C\uD2B8\uB9AC \uACA9\uB9AC \uC5C6\uC774 \uC9C1\uC811 \uC2E4\uD589\uB429\uB2C8\uB2E4. \uD504\uB85C\uC81D\uD2B8 \uACBD\uB85C\uC5D0\uC11C "git init" \uC2E4\uD589 \uD6C4 \uC7AC\uD655\uC778\uD558\uC138\uC694.',
    'header.recheckGit': 'Git \uC0C1\uD0DC \uC7AC\uD655\uC778',

    // Project Form
    'form.newProject': '\uC0C8 \uD504\uB85C\uC81D\uD2B8',
    'form.projectName': '\uD504\uB85C\uC81D\uD2B8 \uC774\uB984',
    'form.folderPath': '\uD3F4\uB354 \uACBD\uB85C',
    'form.cancel': '\uCDE8\uC18C',
    'form.create': '\uC0DD\uC131',

    // Todo List
    'todos.title': '\uC791\uC5C5 \uBAA9\uB85D',
    'todos.add': '\uC791\uC5C5 \uCD94\uAC00',
    'todos.empty': '\uC791\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4',
    'todos.emptyHint': '\uC791\uC5C5\uC744 \uCD94\uAC00\uD574\uBCF4\uC138\uC694.',

    // Todo Item
    'todo.description': '\uC124\uBA85',
    'todo.noDescription': '\uC124\uBA85\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.',
    'todo.branch': '\uBE0C\uB79C\uCE58',
    'todo.path': '\uACBD\uB85C',
    'todo.mergeFailed': '\uBCD1\uD569 \uC2E4\uD328',
    'todo.diffError': 'Diff \uC624\uB958',
    'todo.diffOutput': '\uBCC0\uACBD\uC0AC\uD56D',
    'todo.files': '\uD30C\uC77C',
    'todo.systemLog': '\uD65C\uB3D9 \uB85C\uADF8',
    'todo.start': '\uC2DC\uC791',
    'todo.startHeadless': 'Headless: -p \uD50C\uB798\uADF8\uB85C \uC790\uC728 \uC2E4\uD589. \uBAA8\uB4E0 \uAD8C\uD55C \uC790\uB3D9 \uC2B9\uC778 (--dangerously-skip-permissions). \uC0AC\uC6A9\uC790 \uC785\uB825 \uBD88\uD544\uC694.',
    'todo.startStreaming': 'Streaming: stdin\uC73C\uB85C \uD504\uB86C\uD504\uD2B8 \uC804\uB2EC \uD6C4 \uC790\uC728 \uC2E4\uD589. \uBAA8\uB4E0 \uAD8C\uD55C \uC790\uB3D9 \uC2B9\uC778. \uAE34 \uD504\uB86C\uD504\uD2B8\uB098 \uD2B9\uC218\uBB38\uC790\uC5D0 \uC801\uD569.',
    'todo.startInteractive': 'Interactive: stdin\uC744 \uC5F4\uC5B4\uB450\uACE0 \uC2E4\uD589 \uC911 Claude\uC5D0\uAC8C \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uAC00\uB2A5. \uBAA8\uB4E0 \uAD8C\uD55C \uC790\uB3D9 \uC2B9\uC778.',
    'todo.sendPlaceholder': 'Claude\uC5D0\uAC8C \uBA54\uC2DC\uC9C0 \uC785\uB825...',
    'todo.stop': '\uC911\uC9C0',
    'todo.viewDiff': 'Diff \uBCF4\uAE30',
    'todo.merge': '\uBCD1\uD569',
    'todo.edit': '\uD3B8\uC9D1',
    'todo.delete': '\uC0AD\uC81C',
    'todo.cleanup': '\uC6CC\uD06C\uD2B8\uB9AC \uC0AD\uC81C',
    'todo.cleanupFailed': '\uC815\uB9AC \uC2E4\uD328',

    // Todo Form
    'todoForm.titlePlaceholder': '\uC791\uC5C5 \uC81C\uBAA9...',
    'todoForm.descPlaceholder': '\uC124\uBA85 (\uC120\uD0DD\uC0AC\uD56D)...',
    'todoForm.cancel': '\uCDE8\uC18C',
    'todoForm.save': '\uC800\uC7A5',

    // Status
    'status.pending': '\uB300\uAE30',
    'status.running': '\uC2E4\uD589 \uC911',
    'status.completed': '\uC644\uB8CC',
    'status.failed': '\uC2E4\uD328',
    'status.stopped': '\uC911\uC9C0',
    'status.merged': '\uBCD1\uD569\uB428',

    // Progress
    'progress.complete': '\uC644\uB8CC',
    'progress.done': '\uC644\uB8CC',
    'progress.live': '\uC2E4\uD589 \uC911',
    'progress.idle': '\uB300\uAE30',
    'progress.fail': '\uC2E4\uD328',
    'progress.stop': '\uC911\uC9C0',
    'progress.merged': '\uBCD1\uD569\uB428',

    // Log
    'log.awaiting': '\uCD9C\uB825 \uB300\uAE30 \uC911...',
    'log.noChanges': '\uBCC0\uACBD\uC0AC\uD56D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.',

    // Language
    'lang.toggle': 'EN',
  },
} as const;

type TranslationKey = keyof typeof translations.en;

interface I18nContextType {
  lang: Lang;
  toggleLang: () => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('clitrigger-lang');
    return (saved === 'ko' || saved === 'en') ? saved : 'ko';
  });

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next = prev === 'en' ? 'ko' : 'en';
      localStorage.setItem('clitrigger-lang', next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[lang][key] ?? key;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
