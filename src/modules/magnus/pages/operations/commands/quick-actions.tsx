import type { ReactNode } from 'react';
import { Activity, ArrowUpCircle, Clock, FileText, HardDrive, MemoryStick, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';

export interface QuickAction {
  label: string;
  command: string;
  icon: ReactNode;
  variant?: 'warning' | 'danger';
  description: string;
  timeoutSeconds?: number;
}

/** Common Ubuntu administration tasks. A click only fills in the command; nothing runs until Execute is confirmed. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { label: 'Update & Upgrade', command: 'sudo apt update && sudo apt upgrade -y', icon: <RefreshCw className="size-4" />, description: 'Update package lists and upgrade all packages' },
  { label: 'Dist-Upgrade', command: 'sudo apt update && sudo apt dist-upgrade -y', icon: <ArrowUpCircle className="size-4" />, variant: 'warning', description: 'Full distribution upgrade with dependency resolution' },
  { label: 'Autoremove', command: 'sudo apt autoremove -y && sudo apt autoclean', icon: <Trash2 className="size-4" />, description: 'Remove unused packages and clean package cache' },
  { label: 'Security Updates', command: 'sudo apt update && sudo apt list --upgradable 2>/dev/null | grep -i security', icon: <ShieldCheck className="size-4" />, description: 'Check for pending security updates' },
  { label: 'Disk Usage', command: 'df -h', icon: <HardDrive className="size-4" />, description: 'Show disk space usage on all mounted filesystems' },
  { label: 'Memory & Top', command: 'free -h && echo "---" && top -bn1 | head -20', icon: <MemoryStick className="size-4" />, description: 'Show memory usage and top processes' },
  { label: 'Running Services', command: 'systemctl list-units --type=service --state=running --no-pager', icon: <Activity className="size-4" />, description: 'List all currently running systemd services' },
  { label: 'Uptime & Load', command: '/usr/bin/uptime', timeoutSeconds: 60, icon: <Clock className="size-4" />, description: 'Show uptime and load with the registered 60-second diagnostic budget' },
  { label: 'Tail Syslog', command: 'sudo tail -100 /var/log/syslog', icon: <FileText className="size-4" />, description: 'Show the last 100 lines of the system log' },
  { label: 'Reboot', command: 'sudo reboot', icon: <RotateCcw className="size-4" />, variant: 'danger', description: 'Immediately reboot the node' },
];

const DESTRUCTIVE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:reboot|shutdown|poweroff|halt)\b|\binit\s+[06]\b/, 'This takes the target nodes offline, and anything running on them stops.'],
  [/\b(?:dist-upgrade|full-upgrade)\b/, 'This can remove packages and replace the kernel, and it may leave the nodes needing a reboot.'],
  [/\brm\s+-\w*[rf]|\bmkfs\b|\bdd\b[^|;&]*\bof=|\bwipefs\b|\bfdisk\b/, 'This deletes data that cannot be brought back.'],
];
/** Why a command deserves a second look, for the confirmation. Every Execute is confirmed either way. */
export function destructiveWarning(command: string): string | null {
  return DESTRUCTIVE.find(([pattern]) => pattern.test(command))?.[1] ?? null;
}
export const nodeCount = (count: number): string => `${count} node${count === 1 ? '' : 's'}`;
/** What the confirmation says: how many nodes, and exactly what they will run. */
export function executeMessage(command: string, count: number): string {
  const warning = destructiveWarning(command);
  return `${nodeCount(count)} will run this command:\n\n${command}${warning ? `\n\n${warning}` : ''}`;
}

export function resultText(result: { exitCode: number; stdout: string; stderr: string }): string {
  return `Exit: ${result.exitCode}\n\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

/** Only ONLINE nodes can be targeted, so "all" means all of them, whatever else is registered. */
export function toggleAllOnline(selected: readonly string[], online: readonly string[]): string[] {
  const all = online.length > 0 && online.every((id) => selected.includes(id));
  return all ? [] : [...online];
}
