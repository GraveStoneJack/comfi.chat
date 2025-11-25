const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Media = require('../models/Media');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (_req, file, cb) {
        const ext = path.extname(file.originalname) || '.jpg';
        const base = path.basename(file.originalname, ext).replace(/[^a-z0-9\-_.]/gi, '_');
        const name = `${Date.now()}_${base}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const ok = /\.(png|jpe?g|gif|webp|avif)$/i.test(file.originalname);
        if (!ok) return cb(new Error('Only image files are allowed'));
        cb(null, true);
    }
});

router.post('/', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const publicUrl = `/uploads/${req.file.filename}`;
        // Persist a copy to Mongo for durability (admin-only retrieval)
        try {
            const absPath = path.join(uploadsDir, req.file.filename);
            const data = fs.readFileSync(absPath);
            const contentType = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.avif': 'image/avif'
            }[path.extname(req.file.filename).toLowerCase()] || 'application/octet-stream';
            const uploader = (req.query && req.query.u) || (req.headers['x-uploader-username']) || undefined;
            Media.create({
                filename: req.file.filename,
                originalUrl: publicUrl,
                uploader,
                bytes: data,
                byteLength: data.length,
                contentType
            }).catch(e => console.error('[Upload] Failed to persist media copy:', e));
        } catch (e) {
            console.error('[Upload] persist copy error:', e);
        }
        return res.json({ fileUrl: publicUrl });
    } catch (e) {
        console.error('[Upload] error:', e);
        return res.status(500).json({ error: 'Upload failed' });
    }
});

// Public resolver: return file bytes from local uploads (no DB fallback)
router.get('/resolve', (req, res) => {
    try {
        const src = (req.query && req.query.src) ? String(req.query.src) : '';
        if (!src) return res.status(400).send('Missing src');
        // Accept absolute or relative; normalize to local file path under uploadsDir
        const match = /\/uploads\/([^?#]+)/.exec(src);
        if (!match) return res.status(400).send('Unsupported source');
        const filename = match[1];
        const filePath = path.join(uploadsDir, filename);
        if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
        const ext = path.extname(filename).toLowerCase();
        const contentType = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.avif': 'image/avif'
        }[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        fs.createReadStream(filePath).pipe(res);
    } catch (e) {
        console.error('[Upload] resolve error:', e);
        res.status(500).send('Failed to resolve');
    }
});

module.exports = router;


