/**
 * SIDD TECHX — Visitor Tracker (backend)
 * ----------------------------------------------------------------
 * Minimal Express server that stores visit stats in a JSON file on
 * disk (no database needed for something this small). Tracks, per
 * visit:
 *   - country (resolved server-side from the visitor's IP, so it
 *     can't be spoofed by editing client-side JS)
 *   - browser family (Chrome, Firefox, Safari, Edge, Opera, Other),
 *     parsed from the User-Agent header sent automatically by the
 *     browser with every request — this is standard, always-public
 *     information, not fingerprinting.
 *
 * No personal data (name, email, exact IP) is ever stored. The IP
 * is used only in-memory for the single geo lookup and discarded.
 *
 * Data file: ./data/stats.json
 * Endpoints:
 *   POST /api/visit   -> records one visit, returns nothing sensitive
 *   GET  /api/stats    -> returns { total, countries: {...}, browsers: {...} }
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'stats.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ---------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------
function loadStats() {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return { total: 0, countries: {}, browsers: {} };
    }
}

function saveStats(stats) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
}

// Simple in-process write queue so concurrent requests don't clobber
// each other when reading+writing the JSON file.
let writeQueue = Promise.resolve();
function recordVisit(country, browser) {
    writeQueue = writeQueue.then(() => {
        const stats = loadStats();
        stats.total = (stats.total || 0) + 1;
        stats.countries = stats.countries || {};
        stats.browsers = stats.browsers || {};
        stats.countries[country] = (stats.countries[country] || 0) + 1;
        stats.browsers[browser] = (stats.browsers[browser] || 0) + 1;
        saveStats(stats);
    });
    return writeQueue;
}

// ---------------------------------------------------------------
// Country lookup (server-side, from the request's IP)
// Uses ip-api.com's free tier (no key required, reasonable rate
// limit for a small personal site). Falls back to "Unknown" if
// the lookup fails or the IP is local/private (e.g. dev/testing).
// ---------------------------------------------------------------
function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.socket.remoteAddress || '';
}

function isPrivateIp(ip) {
    return !ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') ||
        ip.startsWith('10.') || ip.startsWith('::ffff:127.');
}

function lookupCountry(ip) {
    return new Promise((resolve) => {
        if (isPrivateIp(ip)) return resolve('Unknown');
        https.get(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country`, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data.status === 'success' && data.country ? data.country : 'Unknown');
                } catch (e) {
                    resolve('Unknown');
                }
            });
        }).on('error', () => resolve('Unknown'));
    });
}

// ---------------------------------------------------------------
// Browser detection from User-Agent (server-side, so it can't be
// tampered with as easily as a client-only check). Order matters:
// Edge/Opera/Samsung UAs also contain "Chrome", so check them first.
// ---------------------------------------------------------------
function detectBrowser(userAgent) {
    const ua = (userAgent || '').toLowerCase();
    if (ua.includes('edg/')) return 'Edge';
    if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
    if (ua.includes('samsungbrowser')) return 'Samsung Internet';
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('chrome') || ua.includes('crios')) return 'Chrome';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    return 'Other';
}

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------
app.post('/api/visit', async (req, res) => {
    try {
        const ip = getClientIp(req);
        const country = await lookupCountry(ip);
        const browser = detectBrowser(req.headers['user-agent']);
        await recordVisit(country, browser);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Failed to record visit' });
    }
});

app.get('/api/stats', (req, res) => {
    const stats = loadStats();
    res.json({
        total: stats.total || 0,
        countries: stats.countries || {},
        browsers: stats.browsers || {}
    });
});

app.listen(PORT, () => {
    console.log(`Visitor tracker running on port ${PORT}`);
});
