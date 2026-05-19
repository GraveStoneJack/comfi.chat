const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Media = require('../models/Media');

const router = express.Router();

function mediaBuffer(bytes) {
    if (!bytes) return null;
    if (Buffer.isBuffer(bytes)) return bytes;
    if (bytes.buffer && Buffer.isBuffer(bytes.buffer)) return bytes.buffer;
    if (bytes.buffer) return Buffer.from(bytes.buffer);
    if (Array.isArray(bytes.data)) return Buffer.from(bytes.data);
    return Buffer.from(bytes);
}

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

// Public resolver: local disk first, then MongoDB copy (Render disk is ephemeral)
router.get('/resolve', async (req, res) => {
    try {
        const src = (req.query && req.query.src) ? String(req.query.src) : '';
        if (!src) return res.status(400).send('Missing src');
        const match = /\/uploads\/([^?#]+)/.exec(src);
        const filename = match ? match[1] : null;
        const sendHeaders = (contentType, cacheControl) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', cacheControl);
        };
        if (filename) {
            const filePath = path.join(uploadsDir, filename);
            if (fs.existsSync(filePath)) {
                const ext = path.extname(filename).toLowerCase();
                const contentType = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.avif': 'image/avif'
                }[ext] || 'application/octet-stream';
                sendHeaders(contentType, 'public, max-age=31536000, immutable');
                return fs.createReadStream(filePath).pipe(res);
            }
        }
        let mediaDoc = null;
        if (filename) {
            mediaDoc = await Media.findOne({ filename, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
        }
        if (!mediaDoc) {
            const normalized = filename ? `/uploads/${filename}` : src;
            mediaDoc = await Media.findOne({
                $or: [{ originalUrl: normalized }, { originalUrl: src }],
                deletedAt: { $exists: false }
            }).sort({ createdAt: -1 }).lean();
        }
        if (!mediaDoc || !mediaDoc.bytes) return res.status(404).send('Not found');
        const bytes = mediaBuffer(mediaDoc.bytes);
        if (!bytes) return res.status(404).send('Not found');
        sendHeaders(mediaDoc.contentType || 'application/octet-stream', 'public, max-age=31536000, immutable');
        return res.end(bytes);
    } catch (e) {
        console.error('[Upload] resolve error:', e);
        res.status(500).send('Failed to resolve');
    }
});

module.exports = router;


