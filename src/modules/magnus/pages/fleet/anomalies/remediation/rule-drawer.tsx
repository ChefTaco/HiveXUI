import { useState, type FormEvent } from 'react';
import { Button, Drawer, Field, Select, TextArea, TextInput, Toggle } from '@ui';
import { useToast } from '../../../../../../components/toast';
import { magnus, segment } from '../../../../api/client';
import { errorMessage } from '../../../../api/errors';
import { EMPTY_RULE_FORM, METRICS, ruleBody, ruleToForm, RUNBOOKS, SEVERITY_THRESHOLDS, type RuleForm } from '../model';
import { remediationRuleResponseSchema, type RemediationRule } from '../schemas';

/** Mount it only while open: each opening starts from the rule, or from an empty form. */
export function RuleDrawer({ rule, takenNames, onClose, onSaved }: { rule: RemediationRule | null; takenNames: readonly string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<RuleForm>(() => (rule ? ruleToForm(rule) : EMPTY_RULE_FORM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof RuleForm>(key: K) => (value: RuleForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    const request = ruleBody(form, !!rule);
    if ('error' in request) {
      setError(request.error);
      return;
    }
    // Names are unique, and the API reports a clash as a raw database error.
    if (form.name.trim() !== rule?.name && takenNames.includes(form.name.trim())) {
      setError('A rule with this name already exists.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (rule) await magnus.patch(`/remediation/rules/${segment(rule.id)}`, remediationRuleResponseSchema, { body: request.body });
      else await magnus.post('/remediation/rules', remediationRuleResponseSchema, { body: request.body });
      toast.success(rule ? `${form.name.trim()} updated` : `${form.name.trim()} created`);
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The rule could not be saved'));
    } finally {
      setSaving(false);
    }
  }
  // A rule from before versioned runbooks stays visible until the operator picks one.
  const runbooks = RUNBOOKS.some(({ value }) => value === form.agentDefinitionId) ? RUNBOOKS : [{ value: form.agentDefinitionId, label: `${form.agentDefinitionId} (retired)` }, ...RUNBOOKS];
  return (
    <Drawer open title={rule ? 'Edit rule' : 'New rule'} eyebrow="Auto-remediation" onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <Field label="Name"><TextInput value={form.name} onChange={set('name')} required maxLength={200} placeholder="disk-cleanup-rule" /></Field>
        <Field label="Versioned runbook"><Select value={form.agentDefinitionId} onChange={set('agentDefinitionId')} options={runbooks} /></Field>
        <div className="form-grid">
          <Field label="Metric"><Select value={form.metric} onChange={set('metric')} options={METRICS.map((value) => ({ value, label: value === '*' ? 'All metrics' : value }))} /></Field>
          <Field label="Severity threshold"><Select value={form.severityThreshold} onChange={set('severityThreshold')} options={SEVERITY_THRESHOLDS.map((value) => ({ value, label: value }))} /></Field>
          <Field label="Cooldown (minutes)"><TextInput type="number" min={1} max={10_080} value={form.cooldownMinutes} onChange={set('cooldownMinutes')} required /></Field>
          <Field label="Max concurrent runs"><TextInput type="number" min={1} max={10} value={form.maxConcurrentRuns} onChange={set('maxConcurrentRuns')} required /></Field>
        </div>
        <Field label="Description"><TextInput value={form.description} onChange={set('description')} maxLength={1000} placeholder="Preview a bounded diagnostic when a metric needs investigation" /></Field>
        <Field label="Node filter" hint="Optional: a node ID or name"><TextInput value={form.nodeFilter} onChange={set('nodeFilter')} maxLength={200} /></Field>
        <Field label="Runbook configuration (JSON)" hint="restart-service.v1 needs the ID of an application with an allowlisted restart service."><TextArea className="font-mono" rows={3} maxLength={2000} value={form.input} onChange={set('input')} placeholder='{"applicationId":"configured-application-id"}' /></Field>
        <Toggle checked={form.enabled} onChange={set('enabled')} label="Enabled" />
        {error ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!form.name.trim()}>{rule ? 'Update rule' : 'Create rule'}</Button>
        </div>
      </form>
    </Drawer>
  );
}
