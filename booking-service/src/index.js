// Booking Service - Main Entry Point
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
require('dotenv').config();

const { pool } = require('./config/database');
const bookingRoutes = require('./routes/bookings');
const { sendReminders } = require('./jobs/reminders');

const app = express();
const PORT = process.env.PORT || 3002;

// ============================================
// MIDDLEWARE
// ============================================

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// ROUTES
// ============================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      service: 'booking-service',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

app.use('/api/bookings', bookingRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Only start the server and cron when run directly (not when imported by tests)
if (require.main === module) {
  // ============================================
  // CRON JOBS
  // ============================================

  // Send reminder emails every hour
  cron.schedule('0 * * * *', async () => {
    console.log('🔔 Running reminder job...');
    try {
      await sendReminders();
    } catch (error) {
      console.error('Reminder job failed:', error);
    }
  });

  // ============================================
  // START SERVER
  // ============================================

  const server = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   📅 Booking Service Started          ║
║   Port: ${PORT}                        ║
║   Environment: ${process.env.NODE_ENV || 'development'}         ║
╚════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    server.close(() => {
      pool.end(() => {
        process.exit(0);
      });
    });
  });
}

module.exports = app;