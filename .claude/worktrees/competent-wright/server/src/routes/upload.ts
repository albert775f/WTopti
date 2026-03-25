import { Router } from 'express';
import multer from 'multer';
import pool from '../db';
import { parseArtikel, parseBestellungen, parseBestand } from '../parser';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/upload/static — upload Artikelliste + Bestellungen (one-time)
router.post('/static', upload.fields([
  { name: 'artikel', maxCount: 1 },
  { name: 'bestellungen', maxCount: 1 },
]), async (req, res) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]>;
    if (!files.artikel?.[0] || !files.bestellungen?.[0]) {
      res.status(400).json({ error: 'Both artikel and bestellungen files required' });
      return;
    }

    const artikelRows = parseArtikel(files.artikel[0].buffer);
    const bestellungenRows = parseBestellungen(files.bestellungen[0].buffer);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing data
      await client.query('DELETE FROM artikel');
      await client.query('DELETE FROM bestellungen');

      // Insert artikel
      for (const a of artikelRows) {
        await client.query(
          `INSERT INTO artikel (artikelnummer, bezeichnung, hoehe_mm, breite_mm, laenge_mm, gewicht_kg, volumen_l, grundflaeche_mm2, max_stapelhoehe, sperrgut)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (artikelnummer) DO UPDATE SET
             bezeichnung=$2, hoehe_mm=$3, breite_mm=$4, laenge_mm=$5, gewicht_kg=$6, volumen_l=$7, grundflaeche_mm2=$8, max_stapelhoehe=$9, sperrgut=$10`,
          [a.artikelnummer, a.bezeichnung, a.hoehe_mm, a.breite_mm, a.laenge_mm, a.gewicht_kg, a.volumen_l ?? null, a.grundflaeche_mm2, a.max_stapelhoehe, a.sperrgut ?? null]
        );
      }

      // Insert bestellungen
      for (const b of bestellungenRows) {
        await client.query(
          `INSERT INTO bestellungen (belegnummer, artikelnummer, menge, datum, bezeichnung) VALUES ($1,$2,$3,$4,$5)`,
          [b.belegnummer, b.artikelnummer, b.menge, b.datum ?? null, b.bezeichnung ?? null]
        );
      }

      // Update metadata
      await client.query(
        `INSERT INTO metadata (key, value) VALUES ('static_uploaded_at', $1)
         ON CONFLICT (key) DO UPDATE SET value=$1`,
        [new Date().toISOString()]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, artikelCount: artikelRows.length, bestellungenCount: bestellungenRows.length });
  } catch (err) {
    console.error('Upload static error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/upload/bestand — upload current stock list
router.post('/bestand', upload.single('bestand'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'bestand file required' });
      return;
    }

    const bestandRows = parseBestand(req.file.buffer);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM bestand');
      for (const b of bestandRows) {
        await client.query(
          `INSERT INTO bestand (artikelnummer, bestand) VALUES ($1,$2)`,
          [b.artikelnummer, b.bestand]
        );
      }
      await client.query(
        `INSERT INTO metadata (key, value) VALUES ('bestand_uploaded_at', $1)
         ON CONFLICT (key) DO UPDATE SET value=$1`,
        [new Date().toISOString()]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, bestandCount: bestandRows.length });
  } catch (err) {
    console.error('Upload bestand error:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
