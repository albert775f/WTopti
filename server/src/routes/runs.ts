import { Router } from 'express';
import pool from '../db';

const router = Router();

// POST /api/runs — save a completed optimization run
router.post('/', async (req, res) => {
  try {
    const { config, stats, metrics, result, commit_hash } = req.body;
    if (!config || !stats || !result) {
      res.status(400).json({ error: 'config, stats and result are required' });
      return;
    }

    const metaResult = await pool.query(
      "SELECT value FROM metadata WHERE key = 'bestand_uploaded_at'"
    );
    const bestand_uploaded_at = metaResult.rows[0]?.value ?? null;

    const { rows } = await pool.query(
      `INSERT INTO runs (bestand_uploaded_at, commit_hash, config, stats, metrics, result)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [bestand_uploaded_at, commit_hash ?? null, JSON.stringify(config), JSON.stringify(stats), JSON.stringify(metrics ?? null), JSON.stringify(result)]
    );

    res.json({ id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    console.error('Save run error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/runs — list all runs (summary only, no full result)
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, bestand_uploaded_at, commit_hash, stats, metrics
       FROM runs
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('List runs error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/runs/:id — fetch full result for a run
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, bestand_uploaded_at, config, stats, metrics, result
       FROM runs WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Get run error:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
