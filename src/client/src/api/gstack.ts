import { get } from './client';
import type { GstackSkill } from '../types';

export function getAvailableSkills(): Promise<GstackSkill[]> {
  return get('/api/gstack/skills');
}
