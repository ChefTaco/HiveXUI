import type { SkillScanResult } from './schemas';

export interface InstalledSkill {
  name: string;
  version: string;
  description: string;
  author: string;
  entryPoint: string;
  dependencies: string[];
  tags: string[];
  files: Array<{ name: string; content: string }>;
}
export interface NodeSkills {
  nodeId: string;
  nodeName: string;
  status: 'done' | 'error';
  skills: InstalledSkill[];
  error?: string | undefined;
}

export function normalizeScan(results: readonly SkillScanResult[]): NodeSkills[] {
  return results.map((result) => ({
    nodeId: result.nodeId,
    nodeName: result.nodeName,
    status: result.status === 'error' ? 'error' : 'done',
    error: result.error,
    skills: result.skills.map((skill) => ({
      name: skill.name,
      version: skill.version ?? '',
      description: skill.description ?? '',
      author: skill.author ?? '',
      entryPoint: skill.entryPoint ?? '',
      dependencies: skill.dependencies ?? [],
      tags: skill.tags ?? [],
      files: (skill.files ?? []).map((file) => (typeof file === 'string' ? { name: file, content: '' } : { name: file.name, content: file.content ?? '' })),
    })),
  }));
}

export function matchesSkill(skill: InstalledSkill, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle) || skill.tags.some((tag) => tag.toLowerCase().includes(needle));
}

/** Nodes with skills open by themselves. If none has any, all open, to show the empty listing. */
export function initiallyExpanded(nodes: readonly NodeSkills[]): Set<string> {
  const withSkills = nodes.filter((node) => node.skills.length > 0);
  return new Set((withSkills.length > 0 ? withSkills : nodes).map((node) => node.nodeId));
}
