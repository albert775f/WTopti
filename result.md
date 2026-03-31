# WTopti M7 Optimization — Session Result

## Goal
Get M7 (co-location hit rate) ≥ 30% while keeping C1=0, C2=0, WTs low.

---

## Diagnosis

**Restored baseline** — reverted a stale `step2FillGaps` sort order change (freeDepth DESC → uniqueArts DESC primary). Confirmed 26.3% baseline.

**Added diagnostics to `harness/run.ts`**:
- Classified non-co-located pairs by depth type: full×full / full×standard / std×std
- Counted pairs with free WT capacity (theoretically step2-fixable)

**Findings**:
| Category | Count |
|---|---|
| full×full (geometrically hardest) | 135 |
| full×standard | 642 |
| std×std (expected easiest) | 1273 |
| ALL WTs full, step2 blocked | 1027 |

Every sample non-co-located pair had `freeD=0` on all its WTs — packed completely solid. Step2 (3 passes) can't improve because there's no room to move anything.

---

## Root Cause

In `step0ClusterPack`, partners were placed with their **full remaining stock**. Popular "hub" articles (e.g. 1011159, appearing in dozens of affinity pairs) were consumed as partners across multiple anchors' cluster WTs. By the time step1 ran, those hubs had **zero remaining stock**. When article A tried to co-seed hub B during step1, B had nothing left → never co-located.

---

## Failed Attempts

| Change | M7 | WTs | Verdict |
|---|---|---|---|
| `step2` sort: freeDepth DESC primary | 26.2% | 842 | ✗ reverted |
| `step0` skip already-covered pairs | 26.0% | 839 | ✗ reverted |

Both hurt M7 — the algorithm was already near a local optimum for those levers.

---

## Fix (`app/src/algorithm/phase3.ts`)

Added `PARTNER_STOCK_FRACTION = 0.9` constant in `step0ClusterPack`. Each partner now contributes **at most 90%** of its remaining stock to a cluster WT:

```typescript
const PARTNER_STOCK_FRACTION = 0.9;
// ...
const cappedStk = Math.max(1, Math.ceil(pStk * PARTNER_STOCK_FRACTION));
const placed = addArticleToWT(wt, pNr, pArt, cappedStk, config, artDataMap);
```

The reserved 10% flows into step1, where co-seeding and partner-priority WT selection can distribute it across multiple WTs — creating co-locations that step0 missed.

**Tuning** (tested to find minimum WTs at M7 ≥ 30%):

| Fraction | WTs | M7 |
|---|---|---|
| 50% | 939 | 39.8% |
| 75% | 891 | 35.1% |
| 87.5% | 867 | 31.7% |
| **90%** | **862** | **31.6%** ✓ |
| 95% | 854 | 29.5% ✗ |

90% is the sweet spot — minimum WTs while staying above 30%.

---

## Final Result

| Metric | Before | After |
|---|---|---|
| WTs | 842 | 862 (+20, +2.4%) |
| M7 | 26.3% | **31.6%** |
| C1–C7 hard checks | ✓ all | ✓ all |
| Co-located pairs | 730/2780 | 878/2780 |
