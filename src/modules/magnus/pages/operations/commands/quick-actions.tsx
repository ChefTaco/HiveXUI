import type { ReactNode } from 'react';
import { Activity, ArrowUpCircle, Clock, FileText, HardDrive, MemoryStick, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';

export interface QuickAction {
  label: string;
  command: string;
  icon: ReactNode;
  variant?: 'warning' | 'danger';
  description: string;
}

/** Common Ubuntu administration tasks. A click only fills in the command; nothing runs until Execute. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { label: 'Update & Upgrade', command: 'sudo apt update && sudo apt upgrade -y', icon: <RefreshCw className="size-4" />, description: 'Update package lists and upgrade all packages' },
  { label: 'Dist-Upgrade', command: 'sudo apt update && sudo apt dist-upgrade -y', icon: <ArrowUpCircle className="size-4" />, variant: 'warning', description: 'Full distribution upgrade with dependency resolution' },
  { label: 'Autoremove', command: 'sudo apt autoremove -y && sudo apt autoclean', icon: <Trash2 className="size-4" />, description: 'Remove unused packages and clean package cache' },
  { label: 'Security Updates', command: 'sudo apt update && sudo apt list --upgradable 2>/dev/null | grep -i security', icon: <ShieldCheck className="size-4" />, description: 'Check for pending security updates' },
  { label: 'Disk Usage', command: 'df -h', icon: <HardDrive className="size-4" />, description: 'Show disk space usage on all mounted filesystems' },
  { label: 'Memory & Top', command: 'free -h && echo "---" && top -bn1 | head -20', icon: <MemoryStick className="size-4" />, description: 'Show memory usage and top processes' },
  { label: 'Running Services', command: 'systemctl list-units --type=service --state=running --no-pager', icon: <Activity className="size-4" />, description: 'List all currently running systemd services' },
  { label: 'Uptime & Load', command: 'uptime && cat /proc/loadavg', icon: <Clock className="size-4" />, description: 'Show system uptime and CPU load averages' },
  { label: 'Tail Syslog', command: 'sudo tail -100 /var/log/syslog', icon: <FileText className="size-4" />, description: 'Show the last 100 lines of the system log' },
  { label: 'Reboot', command: 'sudo reboot', icon: <RotateCcw className="size-4" />, variant: 'danger', description: 'Immediately reboot the node' },
];

export function resultText(result: { exitCode: number; stdout: string; stderr: string }): string {
  return `Exit: ${result.exitCode}\n\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

/** Only ONLINE nodes can be targeted, so "all" means all of them, whatever else is registered. */
export function toggleAllOnline(selected: readonly string[], online: readonly string[]): string[] {
  const all = online.length > 0 && online.every((id) => selected.includes(id));
  return all ? [] : [...online];
}
