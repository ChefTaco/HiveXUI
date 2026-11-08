// Pure helpers for an Ardent agent's skills: their configured and running state, and installing
// HiveSkills catalog skills (Magnus skill-install).
import type { Tone } from '@ui';
import { SKILL_INSTALL_STUDIO_LEVEL, type ArdentSkill, type SkillInstallResult } from '../schemas';
import { readYamlValue } from '../yaml-settings';

/**
 * A skill as the saved configuration has it (`enabled`, from skills.enabled) and as the running
 * profile reports it (`running`). Ardent's skill list is the running state: the profile loads its
 * configuration when it starts, so a switch or an install shows there only after a restart.
 */
export type SkillState = ArdentSkill & { running: boolean };

/**
 * The skills with `enabled` taken from the configuration text. When the configuration cannot be
 * read, the running state is all there is and both fields carry it.
 */
export function skillStates(skills: readonly ArdentSkill[], configText: string | undefined): SkillState[] {
  let configured: ReadonlySet<string> | null = null;
  if (configText !== undefined) {
    try {
      const value = readYamlValue(configText, ['skills', 'enabled']);
      if (value === null || Array.isArray(value)) configured = new Set(value ?? []);
    } catch {
      // A document the reader cannot follow: fall back to the running state below.
    }
  }
  return skills.map((skill) => ({ ...skill, enabled: configured ? configured.has(skill.name) : skill.enabled, running: skill.enabled }));
}

/** What a skill's badge says: the configured state, and whether the running profile has it yet. */
export function skillStateLabel(skill: { enabled: boolean; running?: boolean | undefined }): { label: string; tone: Tone; pending: boolean } {
  const running = skill.running ?? skill.enabled;
  if (skill.enabled === running) return skill.enabled ? { label: 'Enabled', tone: 'success', pending: false } : { label: 'Disabled', tone: 'neutral', pending: false };
  return { label: `${skill.enabled ? 'Enabled' : 'Disabled'} — applies after restart`, tone: 'warning', pending: true };
}

export interface CatalogSkill {
  slug: string;
  name: string;
  description: string;
}

/** What the console asks Magnus (or Studio) to install. */
export interface SkillInstallRequest {
  source: 'hiveskills';
  name: string;
  version: string;
  enable?: boolean;
  revision?: string;
}

/** A key that changes when the agent's skills or configuration revision do, so a skill list remounts after an install. */
export const skillListKey = (skills: readonly { name: string; enabled: boolean; running?: boolean }[], revision: string): string =>
  `${revision}:${skills.map((skill) => `${skill.name}=${skill.enabled ? 1 : 0}${(skill.running ?? skill.enabled) ? 1 : 0}`).join(',')}`;

/** Catalog skills matching the search in slug, name or description, at most `limit`. */
export function matchCatalog<T extends CatalogSkill>(skills: readonly T[], query: string, limit = 20): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? skills.filter((skill) => {
    const text = `${skill.slug} ${skill.name} ${skill.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  }) : skills;
  return matches.slice(0, limit);
}

/**
 * Why the node cannot install catalog skills, or null when it can or its level is not known yet (null).
 * Magnus still refuses an older agent with 409 AGENT_UPGRADE_REQUIRED.
 */
export function installBlockedReason(studioLevel: number | null, nodeName?: string): string | null {
  if (studioLevel === null || studioLevel >= SKILL_INSTALL_STUDIO_LEVEL) return null;
  return `Upgrade the Magnus agent on ${nodeName ?? 'this node'} to install catalog skills.`;
}

/** The sentence shown after an install. */
export function installOutcome(result: SkillInstallResult): { tone: 'success' | 'warning'; text: string } {
  const what = `${result.name} ${result.version}`;
  const installed = result.changed ? `Installed ${what}` : `${what} was already installed`;
  if (result.enable_error) return { tone: 'warning', text: `${installed}, but it is not enabled: ${result.enable_error}` };
  const enabled = result.enabled ? ' and enabled' : '';
  const restart = result.activation_required ? ' Restart the profile to activate it.' : '';
  return { tone: 'success', text: `${installed}${enabled}.${restart}` };
}

interface ApiFailure { status?: unknown; code?: unknown; message?: unknown }

/** An install failure in words, naming the upgrade when Magnus or Studio predates catalog installs. */
export function installFailure(error: unknown): string {
  const failure = (error && typeof error === 'object' ? error : {}) as ApiFailure;
  const message = typeof failure.message === 'string' && failure.message ? failure.message : 'The skill could not be installed';
  // Magnus before skill-install refuses the unknown action; Studio says so itself.
  if ((failure.status === 400 && message === 'Invalid Ardent action') || failure.code === 'MAGNUS_UPGRADE_REQUIRED')
    return 'This Magnus release cannot install catalog skills. Upgrade Magnus first.';
  if (failure.status === 404 && message === 'No such route')
    return "This Studio service cannot install catalog skills yet. Upgrade Ardent Project Studio, or install from the agent's Magnus profile.";
  if (failure.code === 'HIVESKILLS_UNCONFIGURED') return 'Magnus has no HiveSkills registry configured (MAGNUS_ARDENT_HIVESKILLS_URL), so it cannot install catalog skills.';
  return message;
}
