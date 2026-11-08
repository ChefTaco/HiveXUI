// The Studio service's team validation, mirrored so an edit shows its issues at once. The service
// stays the authority: the designer asks it after each pause in editing and shows its answer when
// it covers the draft on screen. Keep the rules and codes in step with ArdentStudio's
// src/team/validation.ts; the shared fixtures in validation.test.ts pin them.
import type { ValidationIssue, ValidationResult } from '../api/endpoints';
import type { Relationship, Role, TeamDraft } from './model';

export interface AgentFacts {
  /** Running on a reachable node without an error, or null when unknown. */
  available: boolean | null;
  hivemem: 'ok' | 'missing' | 'unknown';
  /** Enabled local skills, or null when they could not be read. */
  skillsEnabled: readonly string[] | null;
}

export interface ValidationInput {
  mode: 'template' | 'assignment';
  roles: ReadonlyArray<Pick<Role, 'key' | 'name' | 'coordinator' | 'deliverables' | 'skills' | 'agent_ref'>>;
  relationships: readonly Relationship[];
  requestedDeliverables?: ReadonlyArray<{ name: string; producer_role_key?: string | null | undefined }>;
  agentFacts?: ReadonlyMap<string, AgentFacts> | undefined;
  /**
   * Whether to warn that some agent facts could not be checked. The console only knows
   * availability, so its mirror leaves that warning to the service.
   */
  reportFactCoverage?: boolean;
}

/** Roles on a directed cycle among the given edges, in a stable order. Empty when acyclic. */
export function cycleMembers(nodes: readonly string[], edges: ReadonlyArray<readonly [string, string]>): string[] {
  const next = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const [from, to] of edges) next.get(from)?.push(to);
  const state = new Map<string, 'visiting' | 'done'>();
  const onCycle = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    state.set(node, 'visiting');
    stack.push(node);
    for (const target of next.get(node) ?? []) {
      if (state.get(target) === 'visiting') {
        for (let index = stack.lastIndexOf(target); index < stack.length; index++) onCycle.add(stack[index]!);
      } else if (!state.has(target)) visit(target);
    }
    stack.pop();
    state.set(node, 'done');
  };
  for (const node of nodes) if (!state.has(node)) visit(node);
  return nodes.filter((node) => onCycle.has(node));
}

export function validateTeam(input: ValidationInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const error = (issue: Omit<ValidationIssue, 'severity'>) => issues.push({ severity: 'error', ...issue });
  const warning = (issue: Omit<ValidationIssue, 'severity'>) => issues.push({ severity: 'warning', ...issue });

  const roles = new Map<string, ValidationInput['roles'][number]>();
  for (const role of input.roles) {
    if (roles.has(role.key)) error({ code: 'duplicate_role_key', message: `Two roles use the key ${role.key}`, role_key: role.key });
    else roles.set(role.key, role);
  }
  const keys = [...roles.keys()];
  const edges: Relationship[] = [];
  input.relationships.forEach((edge, index) => {
    const missing = [edge.from, edge.to].filter((key) => !roles.has(key));
    if (missing.length) {
      error({ code: 'unknown_role', message: `Relationship ${index + 1} names an unknown role: ${missing.join(', ')}`, relationship_index: index });
      return;
    }
    if (edge.from === edge.to) {
      error({ code: 'self_relationship', message: `${roles.get(edge.from)!.name} cannot ${edge.type.replace(/_/g, ' ')} itself`, relationship_index: index, role_key: edge.from });
      return;
    }
    edges.push(edge);
  });
  const of = (type: Relationship['type']) => edges.filter((edge) => edge.type === type);

  const coordinators = input.roles.filter((role) => role.coordinator);
  if (coordinators.length !== 1) {
    error({
      code: 'coordinator_count',
      message:
        coordinators.length === 0
          ? 'The team needs exactly one coordinator; none is set'
          : `The team needs exactly one coordinator; ${coordinators.length} are set (${coordinators.map((role) => role.name).join(', ')})`,
    });
  }
  const reports = of('reports_to');
  const managers = new Map<string, string[]>();
  for (const edge of reports) managers.set(edge.from, [...(managers.get(edge.from) ?? []), edge.to]);
  for (const [key, targets] of managers) {
    const role = roles.get(key)!;
    if (role.coordinator) error({ code: 'coordinator_reports', message: `The coordinator ${role.name} is the root of the team and cannot report to another role`, role_key: key });
    else if (targets.length > 1) error({ code: 'multiple_managers', message: `${role.name} reports to more than one role`, role_key: key });
  }
  const reportingCycle = cycleMembers(keys, reports.map((edge) => [edge.from, edge.to] as const));
  if (reportingCycle.length) {
    error({ code: 'reporting_cycle', message: `Reporting lines form a cycle: ${reportingCycle.map((key) => roles.get(key)!.name).join(' → ')}`, role_key: reportingCycle[0]! });
  } else if (coordinators.length === 1) {
    const root = coordinators[0]!.key;
    for (const role of input.roles) {
      if (role.key === root || !roles.has(role.key)) continue;
      let current: string | undefined = role.key;
      const seen = new Set<string>();
      while (current && current !== root && !seen.has(current)) {
        seen.add(current);
        current = managers.get(current)?.[0];
      }
      if (current !== root) warning({ code: 'outside_reporting_tree', message: `${role.name} does not report, directly or indirectly, to the coordinator`, role_key: role.key });
    }
  }

  const workflowCycle = cycleMembers(keys, of('hands_off_to').filter((edge) => edge.stage !== 'revise').map((edge) => [edge.from, edge.to] as const));
  if (workflowCycle.length) {
    error({ code: 'workflow_cycle', message: `Hand-offs form a cycle that is not a revise loop: ${workflowCycle.map((key) => roles.get(key)!.name).join(' → ')}`, role_key: workflowCycle[0]! });
  }

  const producers = (deliverable: { name: string; producer_role_key?: string | null | undefined }) =>
    input.roles.filter((role) => role.deliverables.includes(deliverable.name) || (deliverable.producer_role_key != null && role.key === deliverable.producer_role_key));
  for (const deliverable of input.requestedDeliverables ?? []) {
    if (!producers(deliverable).length) error({ code: 'deliverable_without_producer', message: `No role produces the deliverable ${deliverable.name}`, deliverable: deliverable.name });
  }

  let agentFacts: ValidationResult['agent_facts'] = 'complete';
  if (input.mode === 'assignment') {
    const bound = input.roles.filter((role) => role.agent_ref);
    for (const role of input.roles) if (!role.agent_ref) warning({ code: 'unbound_role', message: `${role.name} has no agent bound`, role_key: role.key });

    const reviewsTargets = of('reviews');
    const allDeliverables = new Set([...input.roles.flatMap((role) => role.deliverables), ...(input.requestedDeliverables ?? []).map((item) => item.name)]);
    for (const name of allDeliverables) {
      const only = producers({ name, producer_role_key: input.requestedDeliverables?.find((item) => item.name === name)?.producer_role_key });
      if (only.length !== 1 || !only[0]!.agent_ref) continue;
      const producer = only[0]!;
      for (const edge of reviewsTargets.filter((item) => item.to === producer.key)) {
        const reviewer = roles.get(edge.from)!;
        if (reviewer.agent_ref === producer.agent_ref) {
          warning({ code: 'reviewer_is_only_producer', message: `${reviewer.name} reviews ${name}, but the same agent is its only producer (${producer.name})`, role_key: reviewer.key, deliverable: name });
        }
      }
    }

    let known = 0;
    for (const role of bound) {
      const facts = input.agentFacts?.get(role.agent_ref!);
      if (!facts) continue;
      if (facts.available !== null && facts.hivemem !== 'unknown' && facts.skillsEnabled !== null) known++;
      if (facts.available === false) warning({ code: 'agent_unavailable', message: `The agent bound to ${role.name} is not available`, role_key: role.key });
      if (facts.hivemem === 'missing') warning({ code: 'agent_without_hivemem', message: `The agent bound to ${role.name} has no working HiveMem memory`, role_key: role.key });
      if (facts.skillsEnabled) {
        for (const skill of role.skills.filter((item) => item.kind === 'local' && !facts.skillsEnabled!.includes(item.ref))) {
          warning({ code: 'skill_not_enabled', message: `Skill ${skill.ref} is not enabled on the agent bound to ${role.name}`, role_key: role.key });
        }
      }
    }
    if (bound.length) agentFacts = known === bound.length ? 'complete' : known === 0 && !bound.some((role) => input.agentFacts?.has(role.agent_ref!)) ? 'unavailable' : 'partial';
    if (agentFacts !== 'complete' && input.reportFactCoverage !== false) {
      warning({
        code: 'agent_facts_unavailable',
        message: agentFacts === 'unavailable' ? 'Agent availability, skills and HiveMem could not be checked through Magnus' : 'Some agent availability, skills or HiveMem facts could not be checked through Magnus',
      });
    }
  }

  const canPublish = !issues.some((issue) => issue.severity === 'error');
  const coordinator = coordinators.length === 1 ? coordinators[0]! : undefined;
  const coordinatorFacts = coordinator?.agent_ref ? input.agentFacts?.get(coordinator.agent_ref) : undefined;
  return {
    issues,
    can_publish: canPublish,
    can_start_room: canPublish && input.mode === 'assignment' && Boolean(coordinator?.agent_ref) && coordinatorFacts?.available === true,
    agent_facts: agentFacts,
  };
}

/** The console's check of a draft: structure, deliverables, bindings and the availability it knows. */
export function validateDraft(draft: TeamDraft, deliverables: ReadonlyArray<{ name: string; producer_role_key: string | null }>, available: ReadonlyMap<string, boolean>): ValidationResult {
  const agentFacts = new Map<string, AgentFacts>([...available].map(([ref, isAvailable]) => [ref, { available: isAvailable, hivemem: 'unknown', skillsEnabled: null }]));
  return validateTeam({ mode: 'assignment', roles: draft.roles, relationships: draft.relationships, requestedDeliverables: deliverables, agentFacts, reportFactCoverage: false });
}

/** Issues per role, for markers on cards and rows. */
export function issuesByRole(issues: readonly ValidationIssue[]): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) if (issue.role_key) map.set(issue.role_key, [...(map.get(issue.role_key) ?? []), issue]);
  return map;
}
