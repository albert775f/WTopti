import { Router } from 'express';
import pool from '../db';

const router = Router();

// GET /api/status
router.get('/status', async (_req, res) => {
  try {
    const artikelResult = await pool.query('SELECT COUNT(*) FROM artikel');
    const bestellungenResult = await pool.query('SELECT COUNT(*) FROM bestellungen');
    const metaResult = await pool.query(
      "SELECT key, value FROM metadata WHERE key IN ('static_uploaded_at', 'bestand_uploaded_at')"
    );

    const meta: Record<string, string> = {};
    for (const row of metaResult.rows) {
      meta[row.key] = row.value;
    }

    const artikelCount = parseInt(artikelResult.rows[0].count);
    const bestellungenCount = parseInt(bestellungenResult.rows[0].count);
    const hasStaticData = artikelCount > 0;

    res.json({
      hasStaticData,
      artikelCount: hasStaticData ? artikelCount : undefined,
      bestellungenCount: hasStaticData ? bestellungenCount : undefined,
      lastBestandUpload: meta['bestand_uploaded_at'],
    });
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/data — return all stored data for frontend computation
router.get('/data', async (_req, res) => {
  try {
    const [artikelResult, bestellungenResult, bestandResult] = await Promise.all([
      pool.query('SELECT artikelnummer, bezeichnung, hoehe_mm, breite_mm, laenge_mm, gewicht_kg, volumen_l, grundflaeche_mm2, max_stapelhoehe FROM artikel'),
      pool.query('SELECT artikelnummer, menge, belegnummer, datum FROM bestellungen'),
      pool.query('SELECT artikelnummer, bestand FROM bestand'),
    ]);

    res.json({
      artikel: artikelResult.rows.map(r => ({
        artikelnummer: r.artikelnummer,
        bezeichnung: r.bezeichnung,
        hoehe_mm: parseFloat(r.hoehe_mm),
        breite_mm: parseFloat(r.breite_mm),
        laenge_mm: parseFloat(r.laenge_mm),
        gewicht_kg: parseFloat(r.gewicht_kg),
        volumen_l: r.volumen_l ? parseFloat(r.volumen_l) : undefined,
        grundflaeche_mm2: parseFloat(r.grundflaeche_mm2),
        max_stapelhoehe: parseInt(r.max_stapelhoehe),
      })),
      bestellungen: bestellungenResult.rows.map(r => ({
        artikelnummer: r.artikelnummer,
        menge: parseInt(r.menge),
        belegnummer: r.belegnummer,
        datum: r.datum,
      })),
      bestand: bestandResult.rows.map(r => ({
        artikelnummer: r.artikelnummer,
        bestand: parseInt(r.bestand),
      })),
    });
  } catch (err) {
    console.error('Data error:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
