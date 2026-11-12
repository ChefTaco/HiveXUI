import { useEffect, useState } from 'react';
import { BellRing, Save } from 'lucide-react';
import { Button, PageHeader, Select, TableFrame, LoadingRows, ResourceError } from '@ui';
import { useToast } from '../../../../../components/toast';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import { InboxPanel } from './inbox-panel';
import { CATEGORIES, CHANNELS, GROUPS, isEnabled, minSeverity, preferencePayload, samePreferences, setCategorySeverity, SEVERITIES, togglePref } from './prefs';
import { notificationPreferencesResponseSchema, type NotificationPreference } from './schemas';

export default function NotificationsPage() {
  const toast = useToast();
  const saved = useMagnusResource((signal) => magnus.get('/notifications/preferences', notificationPreferencesResponseSchema, { signal }));
  const [draft, setDraft] = useState<NotificationPreference[] | null>(null);
  const [baseline, setBaseline] = useState<NotificationPreference[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!saved.data) return;
    setBaseline(saved.data.data);
    setDraft((current) => current ?? saved.data!.data);
  }, [saved.data]);
  const dirty = draft !== null && !samePreferences(draft, baseline);
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const { data } = await magnus.put('/notifications/preferences', notificationPreferencesResponseSchema, { body: { preferences: preferencePayload(draft) } });
      setBaseline(data);
      setDraft(data);
      toast.success('Notification preferences saved');
    } catch (error) {
      toast.error('Preferences could not be saved', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Notifications"
          eyebrow="Fleet"
          icon={<BellRing className="size-5" />}
          description="Recent fleet notifications, and which ones you receive and how."
          actions={<Button size="sm" variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} className={dirty ? 'glow-accent' : ''} onClick={() => void save()}>Save preferences</Button>}
        />
      </PageItem>
      <PageItem><InboxPanel /></PageItem>
      {!draft ? (
        <PageItem>
          <FxPanel title="Preferences" interactive={false}>{saved.loading ? <LoadingRows rows={6} /> : <ResourceError error={saved.error} title="Preferences could not be loaded" onRetry={() => void saved.refresh()} />}</FxPanel>
        </PageItem>
      ) : GROUPS.map((group) => (
        <PageItem key={group}>
          <FxPanel title={group} interactive={false}>
            <TableFrame label={`${group} notification preferences`}>
              <table className="min-w-[38rem] table-fixed">
                <thead>
                  <tr>
                    <th className="w-1/3">Category</th>
                    {CHANNELS.map(({ id, label }) => <th key={id} className="text-center">{label}</th>)}
                    <th className="w-44 text-center">Minimum severity</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.filter((category) => category.group === group).map((category) => (
                    <tr key={category.id} className="fx-rail">
                      <td>{category.label}</td>
                      {CHANNELS.map((channel) => {
                        const enabled = isEnabled(draft, channel.id, category.id);
                        return (
                          <td key={channel.id} className="text-center">
                            {/* The shared Toggle always shows its label, which a matrix's columns already say. */}
                            <label className="toggle">
                              <input type="checkbox" checked={enabled} aria-label={`${category.label}: ${channel.label}`} onChange={() => setDraft((current) => togglePref(current ?? [], channel.id, category.id))} />
                              <span className={enabled ? 'toggle-track shadow-[0_0_8px_var(--glow-accent)]' : 'toggle-track'} />
                            </label>
                          </td>
                        );
                      })}
                      <td className="text-center">
                        <Select aria-label={`${category.label}: minimum severity`} className="inline-block w-auto" value={minSeverity(draft, category.id)} onChange={(severity) => setDraft((current) => setCategorySeverity(current ?? [], category.id, severity))} options={SEVERITIES.map((value) => ({ value, label: value }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </FxPanel>
        </PageItem>
      ))}
    </div>
  );
}
