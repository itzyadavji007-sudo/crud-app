require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- File upload config (max 10 MB, random stored name) ----
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) =>
    cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

// Serve uploaded files as downloads only (prevents uploaded HTML/JS from running in the browser)
app.use(
  '/api/files',
  express.static(UPLOAD_DIR, {
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

const removeFile = (name) => {
  if (!name) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(name)), () => {});
};

// ---- Health check ----
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

// ---- READ all ----
app.get('/api/items', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM items ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// ---- READ one ----
app.get('/api/items/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// ---- CREATE (multipart/form-data: title, description, file) ----
app.post('/api/items', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    if (req.file) removeFile(req.file.filename);
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO items (title, description, file_name, original_name) VALUES (?, ?, ?, ?)',
      [title.trim(), description || '', req.file ? req.file.filename : null, req.file ? req.file.originalname : null]
    );
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (req.file) removeFile(req.file.filename);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// ---- UPDATE (file optional; if sent, it replaces the old one) ----
app.put('/api/items/:id', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  if (!title || !title.trim()) {
    if (req.file) removeFile(req.file.filename);
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const [existing] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!existing.length) {
      if (req.file) removeFile(req.file.filename);
      return res.status(404).json({ error: 'Item not found' });
    }
    if (req.file) {
      await pool.query(
        'UPDATE items SET title=?, description=?, file_name=?, original_name=? WHERE id=?',
        [title.trim(), description || '', req.file.filename, req.file.originalname, req.params.id]
      );
      removeFile(existing[0].file_name);
    } else {
      await pool.query('UPDATE items SET title=?, description=? WHERE id=?', [
        title.trim(),
        description || '',
        req.params.id,
      ]);
    }
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    if (req.file) removeFile(req.file.filename);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// ---- DELETE ----
app.delete('/api/items/:id', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });
    await pool.query('DELETE FROM items WHERE id = ?', [req.params.id]);
    removeFile(existing[0].file_name);
    res.json({ message: 'Item deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ---- Error handler (e.g. file too large) ----
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 10 MB)' : err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---- Create table if missing, then start ----
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(150) NOT NULL,
      description TEXT,
      file_name VARCHAR(255) NULL,
      original_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    console.log('Database connected');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
})();
