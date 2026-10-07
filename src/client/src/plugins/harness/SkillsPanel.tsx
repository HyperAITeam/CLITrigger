import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import Button from '../../components/Button';
import type { HarnessSkill } from './types';

interface SkillsPanelProps {
  skills: HarnessSkill[] | undefined;
  saving: boolean;
  onSave: (name: string, content: string) => Promise<void>;
  onToggle: (name: string, enabled: boolean) => Promise<void>;
}

// Project-scoped skills (.claude/skills/<name>/SKILL.md): list with the
// frontmatter description, expand a row to edit the SKILL.md in place.
export default function SkillsPanel({ skills, saving, onSave, onToggle }: SkillsPanelProps) {
  const { t } = useI18n();
  const [openName, setOpenName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const list = skills ?? [];
  const open = list.find((s) => s.name === openName) ?? null;
  const dirty = !!open && draft !== open.content;

  const toggle = (skill: HarnessSkill) => {
    if (openName === skill.name) {
      setOpenName(null);
      return;
    }
    setOpenName(skill.name);
    setDraft(skill.content);
  };

  return (
    <div className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-warm-700">Skills</h4>
        <code className="text-[10px] text-warm-400">.claude/skills/</code>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-warm-400">{t('harness.skills.empty') || 'No skills found.'}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((skill) => {
            const isOpen = openName === skill.name;
            return (
              <div key={skill.name} className="border border-warm-150 rounded-lg overflow-hidden">
                <div className="flex items-start gap-2 px-3 py-2 bg-warm-50 hover:bg-warm-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    disabled={saving}
                    onChange={() => onToggle(skill.name, !skill.enabled)}
                    title={skill.enabled ? t('harness.toggle.disable') : t('harness.toggle.enable')}
                    className="mt-0.5 flex-shrink-0 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => toggle(skill)}
                    className={`flex-1 min-w-0 flex items-start gap-2 text-left${skill.enabled ? '' : ' opacity-50'}`}
                  >
                    <span className="mt-0.5 text-warm-400 flex-shrink-0">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-warm-700 font-mono">/{skill.name}</span>
                      {skill.description && (
                        <span className="block text-[11px] text-warm-400 mt-0.5 line-clamp-2">{skill.description}</span>
                      )}
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div className="p-3 space-y-2 border-t border-warm-150">
                    <code className="block text-[10px] text-warm-400 truncate" title={skill.path}>{skill.path}</code>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck={false}
                      className="w-full h-80 px-3 py-2 text-xs font-mono leading-relaxed border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
                    />
                    <div className="flex items-center gap-3">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => dirty && !saving && onSave(skill.name, draft)}
                        disabled={!dirty || saving}
                      >
                        {saving ? t('harness.saving') : t('harness.save')}
                      </Button>
                      {!dirty && <span className="text-xs text-warm-400">{t('harness.noChanges')}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
