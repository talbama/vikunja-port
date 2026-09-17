# Agent metrics — 0 runs, 0 events

_Sources: `/home/runner/work/vikunja-port/vikunja-port/mb/merged.jsonl`_

## Outcome

| metric | value | n | notes/assumptions |
|---|---|---|---|
| time_to_triage | null | 0 | run.start → first triage comment |
| time_to_pr | null | 0 | run.start → github.pr_opened |
| time_to_merge | null | 0 | run.start → github.pr_merged |
| agent_vs_human_time | null | 0 | agent-active = Σ phase.end.duration_s; waiting = time_to_merge − active |
| autonomous_resolution_rate | null | 0 | over all runs; merged as-is = github.pr_merged.diff_changed_since_agent == false |

## Quality

| metric | value | n | notes/assumptions |
|---|---|---|---|
| reproduction_rate | null | 0 | repro.result.failed_on_main == true, over runs |
| fix_rate | null | 0 | passes_after_fix == true, over reproduced runs |
| merged_as_is_rate | null | 0 | merged as-is = github.pr_merged.diff_changed_since_agent == false, over merged PRs |
| reopen_or_revert_rate | null | 0 | issue reopened or PR reverted within 14 days of merge, over merged PRs |

## Calibration

| metric | value | n | notes/assumptions |
|---|---|---|---|
| severity_agreement | null | 0 | over runs with a human severity override; null when n = 0, never 100% |
| routing_accuracy | null | 0 | routing.assigned.owner == github.assignee_final.assignee |
| override_rate_tight | null | 0 | escalated PRs merged as-is, over escalated PRs (high value = gate too tight) |
| override_rate_loose | null | 0 | auto_merge PRs later reverted, over auto-merged PRs (any value > 0 = gate too loose) |

## Cost

| metric | value | n | notes/assumptions |
|---|---|---|---|
| cost_per_run | null | 0 | mean of Σ phase.end.cost_usd per run |
| cost_per_resolved_bug | null | 0 | total cost of all runs (including failures) / merged PRs |
| budget_kill_rate | null | 0 | runs with budget.kill, over runs |

## Learning

| metric | value | n | notes/assumptions |
|---|---|---|---|
| memory_effect | null | 0 | per-run triage cost alongside cases_retrieved and repo_map_version; deltas are vs the first run; a negative token delta is consistent with, not proof of, memory helping; n < 5: table only, no summary statistic |

## Trust

| metric | value | n | notes/assumptions |
|---|---|---|---|
| comments_per_issue | null | 0 | distinct agent comment ids per issue; in-place edits do not count |
| reaction_score | null | 0 | (+1 − −1) / all reactions on agent triage comments |
| zero_engagement_rate | null | 0 | agent comments with no reactions, over agent comments (replies are not collected in v1) |

## Estimate

| metric | value | n | notes/assumptions |
|---|---|---|---|
| hours_returned | null | 0 | ESTIMATE: shape of the calculation, not a measurement; human_fix_time = baseline MTTR × (1 − 0.7) (assumes 0.7 of MTTR is waiting, not working); human review time on an agent PR = github.review.submitted_at − started_at when both exist, else 20 minutes; baseline is historical and from this repo only; no merged agent PRs yet, or baseline incomplete |

## Baseline comparison

Baseline is **historical**, computed from closed `bug` issues in `go-vikunja/vikunja` (n=65, skipped 35: {'no_linked_fix': 35}). MTTR there is issue opened → fix landed.

| metric | agent (median) | human baseline (median) | n agent |
|---|---|---|---|
| time_to_triage | null | 20.0 h | 0 |
| time_to_merge (MTTR) | null | 12.1 d | 0 |
| reopen_or_revert_rate (14d) | null | 0.00 | 0 |


## Policy check (`metrics/policy.yaml`)

```
quiet  suspend_auto_merge_on_revert: override_rate_loose > 0 (value=null, n=0, min_n=1)
quiet  loosen_gate_on_override: override_rate_tight > 0.5 (value=null, n=0, min_n=20)
quiet  shorten_triage_on_downvotes: reaction_score < -0.2 (value=null, n=0, min_n=10)
quiet  budget_ceiling_wrong: budget_kill_rate > 0.2 (value=null, n=0, min_n=10)
```

_Generated 2026-09-17T14:11:00Z by run 35231852411._
