import express from 'express';
import cors from 'cors';
import { initDb } from './db';
import uploadRouter from './routes/upload';
import dataRouter from './routes/data';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

app.use(cors());
app.use(express.json());

app.use('/api/upload', uploadRouter);
app.use('/api', dataRouter);

async function start(): Promise<void> {
  try {
    await initDb();
    console.log('Database initialized');
    app.listen(PORT, () => {
      console.log(`WTopti server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
