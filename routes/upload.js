const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

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
        return res.json({ fileUrl: publicUrl });
    } catch (e) {
        console.error('[Upload] error:', e);
        return res.status(500).json({ error: 'Upload failed' });
    }
});

module.exports = router;


