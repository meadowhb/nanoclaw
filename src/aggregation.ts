import { stripInternalTags } from './router.js';
import type { AgentResponse } from './orchestration-types.js';

/** Input to all aggregation functions. Array order = declaration order (first element declared first). */
export interface MemberResult {
  memberName: string;
  response: AgentResponse;
  /** Unix epoch ms when this member's response arrived. Used by firstSuccess ordering. */
  completedAt: number;
}

export interface MergeWarning {
  type: 'merge_conflict' | 'merge_fallback';
  /** Dot-separated key path where the conflict occurred. Empty string for top-level fallback. */
  path: string;
  /** Both values involved (earlier, later). Present only for merge_conflict. */
  values?: [unknown, unknown];
  /** Member name that triggered fallback. Present only for merge_fallback. */
  memberName?: string;
}

export interface MergeResult {
  result: Record<string, unknown> | null;
  warnings: MergeWarning[];
}

export interface FirstSuccessResult {
  /** The winning response, or null if all failed. */
  winner: AgentResponse | null;
  /** Name of the winning member, or null if all failed. */
  winnerName: string | null;
  /** All other responses (both success and error), ordered by completedAt. */
  others: Array<{ memberName: string; response: AgentResponse }>;
}

export interface SummarizeResult {
  /** All member results passed through unmodified, in input order. */
  results: MemberResult[];
}

/** Strip <internal>…</internal> tags from string values in a result tree. */
function sanitizeResult(value: unknown): unknown {
  if (typeof value === 'string') return stripInternalTags(value);
  if (Array.isArray(value)) return value.map(sanitizeResult);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = sanitizeResult(value[key]);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function joinPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

function cloneAny(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneAny);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = cloneAny(value[key]);
    }
    return out;
  }
  return value;
}

function deepMerge(
  earlier: Record<string, unknown>,
  later: Record<string, unknown>,
  path: string,
  warnings: MergeWarning[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(earlier)) {
    out[key] = cloneAny(earlier[key]);
  }

  for (const key of Object.keys(later)) {
    const earlierValue = out[key];
    const laterValue = later[key];
    const nextPath = joinPath(path, key);

    if (!(key in out)) {
      out[key] = cloneAny(laterValue);
      continue;
    }

    if (isPlainObject(earlierValue) && isPlainObject(laterValue)) {
      out[key] = deepMerge(earlierValue, laterValue, nextPath, warnings);
      continue;
    }

    if (Array.isArray(earlierValue) && Array.isArray(laterValue)) {
      out[key] = earlierValue.concat(laterValue.map(cloneAny));
      continue;
    }

    if (isScalar(earlierValue) && isScalar(laterValue)) {
      out[key] = laterValue;
      continue;
    }

    warnings.push({
      type: 'merge_conflict',
      path: nextPath,
      values: [earlierValue, laterValue],
    });
    out[key] = cloneAny(laterValue);
  }

  return out;
}

export function merge(members: MemberResult[]): MergeResult {
  const successMembers = members.filter((m) => m.response.status === 'success');
  if (successMembers.length === 0) {
    return { result: null, warnings: [] };
  }

  const warnings: MergeWarning[] = [];
  const allPlainObjects = successMembers.every((m) =>
    isPlainObject(m.response.result),
  );

  if (!allPlainObjects) {
    const result: Record<string, unknown> = {};
    for (const m of successMembers) {
      result[m.memberName] = sanitizeResult(m.response.result);
      if (!isPlainObject(m.response.result)) {
        warnings.push({
          type: 'merge_fallback',
          path: '',
          memberName: m.memberName,
        });
      }
    }
    return { result, warnings };
  }

  let merged: Record<string, unknown> = {};
  for (const m of successMembers) {
    merged = deepMerge(
      merged,
      m.response.result as Record<string, unknown>,
      '',
      warnings,
    );
  }
  return {
    result: sanitizeResult(merged) as Record<string, unknown>,
    warnings,
  };
}

export function firstSuccess(members: MemberResult[]): FirstSuccessResult {
  const sorted = members
    .map((m, idx) => ({ m, idx }))
    .sort((a, b) => a.m.completedAt - b.m.completedAt || a.idx - b.idx)
    .map((x) => x.m);

  let winner: AgentResponse | null = null;
  let winnerName: string | null = null;
  let winnerIndex = -1;

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.response.status === 'success') {
      winner = sorted[i]!.response;
      winnerName = sorted[i]!.memberName;
      winnerIndex = i;
      break;
    }
  }

  const others = sorted
    .filter((_, i) => i !== winnerIndex)
    .map((m) => ({ memberName: m.memberName, response: m.response }));

  return { winner, winnerName, others };
}

export function summarize(members: MemberResult[]): SummarizeResult {
  return { results: members };
}
