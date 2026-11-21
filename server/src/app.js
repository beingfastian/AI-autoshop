// server/src/app.js - the Express app (voice + booking routes). server.js starts it; tests import it directly.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { pool } = require('./config/database');
const callRoutes = require('./routes/calls');
const webhookRoutes = require('./routes/webhooks');
const bookingRoutes = require('./routes/bookings');

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
    : '*',
  credentials: true
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limit (call and webhook routes only, as before the merge)
app.use(['/api/calls', '/api/webhooks'], rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  standardHeaders: true,
  legacyHeaders: false
}));

// Health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'ai-receptionist', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'unhealthy', service: 'ai-receptionist', error: e.message });
  }
});

// Routes
app.use('/api/calls', callRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/bookings', bookingRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not Found', path: req.path }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
});

module.exports = app;
