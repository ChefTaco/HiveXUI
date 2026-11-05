export interface HermesInventorySummary {
  installations: number;
  healthyInstallations: number;
  profiles: number;
  runningGateways: number;
}

/** The API keeps rows for hosts that no longer have Hermes; they count as nothing here. */
export function summarizeHermesInventory(
  installations: ReadonlyArray<{ status: string }>,
  profiles: ReadonlyArray<{ gatewayStatus: string; installation?: { status?: string | undefined } | null | undefined }>,
): HermesInventorySummary {
  const installed = installations.filter((item) => item.status !== 'not_installed');
  const current = profiles.filter((item) => item.installation?.status !== 'not_installed');
  return {
    installations: installed.length,
    healthyInstallations: installed.filter((item) => item.status === 'running' || item.status === 'detected').length,
    profiles: current.length,
    runningGateways: current.filter((item) => item.gatewayStatus === 'running').length,
  };
}
