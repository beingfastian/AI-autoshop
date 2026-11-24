// server/src/app.js - the Express app (voice + booking routes). server.js starts it; tests import it directly.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { pool } = require('./config/database');
const { requireVoiceAgentKey } = require('./middleware/apiKey');
const { requireStaff } = require('./middleware/session');
const { overdueCount } = require('./services/notifications');
const callRoutes = require('./routes/calls');
const voiceRoutes = require('./routes/voice');
const authRoutes = require('./routes/auth');
const workshopRoutes = require('./routes/workshop');
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

// Rate limit staff call routes. Not /api/voice: all agent traffic comes from the voice provider's
// shared servers, so a per-IP limit would throttle every shop's calls at once; it uses its own key.
app.use('/api/calls', rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  standardHeaders: true,
  legacyHeaders: false
}));

// Health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    // Messages more than 5 minutes overdue mean the worker is down or stuck: alert on this
    const notificationsOverdue = await overdueCount(5);
    res.json({
      status: 'healthy',
      service: 'ai-receptionist',
      notifications_overdue: notificationsOverdue,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Health check failed:', e);
    res.status(503).json({ status: 'unhealthy', service: 'ai-receptionist' });
  }
});

// Routes. Staff routes take a signed-in user (own shop only) or the admin API_KEY (all shops).
// The voice agent has its own key.
app.use('/api/auth', authRoutes);
app.use('/api/calls', requireStaff, callRoutes);
app.use('/api/bookings', requireStaff, bookingRoutes);
app.use('/api/workshop', requireStaff, workshopRoutes);
app.use('/api/voice', requireVoiceAgentKey, voiceRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not Found', path: req.path }));

// Error handler. Only messages meant for clients (e.g. malformed JSON) are returned; internal errors stay in the log.
app.use((err, req, res, next) => {
  console.error('Error:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.expose ? err.message : 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
});

module.exports = app;
