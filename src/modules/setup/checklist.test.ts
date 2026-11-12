import { describe, expect, it } from 'vitest';
import { orderItems, pendingLabel, productName, recordCommand, verdict, POST_UPGRADE } from './checklist';
import { ADMIN_ITEM, AGENT_ITEM, ARDENT_ITEM, CERTIFICATE_ITEM, setupItem } from './test-fixtures';

describe('the setup checklist', () => {
  it('shows the Registry status, and "Looks done" only for a pending item a probe found done', () => {
    expect(verdict({ ...AGENT_ITEM, status: 'done' }, { state: 'not-done', detail: '' })).toEqual({ label: 'Done', tone: 'success', looksDone: false });
    expect(verdict(CERTIFICATE_ITEM, undefined)).toEqual({ label: 'Skipped', tone: 'neutral', looksDone: false });
    expect(verdict(AGENT_ITEM, undefined).label).toBe('Pending');
    expect(verdict(AGENT_ITEM, { state: 'checking' }).label).toBe('Pending');
    expect(verdict(AGENT_ITEM, { state: 'unknown', detail: '' }).label).toBe('Pending');
    expect(verdict(AGENT_ITEM, { state: 'done', detail: '' })).toEqual({ label: 'Looks done', tone: 'info', looksDone: true });
  });
  it('records a found-done item with post-upgrade, or the item\'s own setup done command', () => {
    expect(recordCommand(AGENT_ITEM)).toBe(POST_UPGRADE);
    expect(recordCommand(ADMIN_ITEM)).toBe('./hive.sh setup done first-admin');
    expect(recordCommand(ARDENT_ITEM)).toBe('./hive.sh setup done ardent-packages-updated');
  });
  it('lists pending items first, each group in the Registry order', () => {
    const items = [CERTIFICATE_ITEM, AGENT_ITEM, { ...ADMIN_ITEM, status: 'done' as const }, ARDENT_ITEM];
    expect(orderItems(items).map((item) => item.id)).toEqual(['magnus-agent-enrolled', 'ardent-packages-updated', 'certificate-renewal', 'first-admin']);
  });
  it('names products it knows and shows any other id as it is', () => {
    expect(productName('magnus')).toBe('Magnus');
    expect(productName('ingress')).toBe('Ingress');
    expect(productName('future-product')).toBe('future-product');
    expect(setupItem('x').product).toBeUndefined();
  });
  it('counts pending steps in words', () => {
    expect(pendingLabel(1)).toBe('1 step pending');
    expect(pendingLabel(3)).toBe('3 steps pending');
  });
});
