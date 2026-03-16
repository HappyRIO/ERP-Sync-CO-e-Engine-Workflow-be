import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { errorHandler } from './utils/errors';
import { logger } from './utils/logger';
import { validatedConfig } from './config/env-validation';
import authRoutes from './routes/auth.routes';
import bookingRoutes from './routes/booking.routes';
import jobRoutes from './routes/job.routes';
import dashboardRoutes from './routes/dashboard.routes';
import assetCategoriesRoutes from './routes/asset-categories.routes';
import clientsRoutes from './routes/clients.routes';
import driverRoutes from './routes/driver.routes';
import vehicleRoutes from './routes/vehicle.routes';
import usersRoutes from './routes/users.routes';
import invitesRoutes from './routes/invites.routes';
import co2Routes from './routes/co2.routes';
import buybackRoutes from './routes/buyback.routes';
import sanitisationRoutes from './routes/sanitisation.routes';
import gradingRoutes from './routes/grading.routes';
import notificationRoutes from './routes/notification.routes';
import organisationProfileRoutes from './routes/organisation-profile.routes';
import documentRoutes from './routes/document.routes';
import siteRoutes from './routes/site.routes';
import uploadsRoutes from './routes/uploads.routes';
import inventoryRoutes from './routes/inventory.routes';

const app: Express = express();

// Trust proxy - required when behind reverse proxy (Nginx)
// This allows Express to correctly identify client IPs from X-Forwarded-For header
app.set('trust proxy', true);

// Extend Request interface to include request ID
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// Security middleware - Helmet
// Configured with strict CSP and additional security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Removed 'unsafe-inline' from styleSrc for better XSS protection
      // If inline styles are needed, use nonces or hashes instead
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      // Allow fonts from self and common CDNs
      fontSrc: ["'self'", "https:", "data:"],
      // Allow connections to self and HTTPS endpoints
      connectSrc: ["'self'", "https:"],
      // Allow object embedding (for PDFs, etc.)
      objectSrc: ["'none'"],
      // Allow base URI
      baseUri: ["'self'"],
      // Disable form actions to prevent form-based attacks
      formAction: ["'self'"],
      // Frame ancestors (X-Frame-Options equivalent)
      frameAncestors: ["'self'"],
    },
  },
  // Enable HSTS (HTTP Strict Transport Security)
  // Only enable in production to avoid issues in development
  hsts: validatedConfig.nodeEnv === 'production' ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  } : false,
  // Explicitly set X-Frame-Options (redundant with CSP frameAncestors, but explicit)
  frameguard: {
    action: 'sameorigin',
  },
  // X-Content-Type-Options: prevent MIME type sniffing
  noSniff: true,
  // X-XSS-Protection (legacy, but still useful for older browsers)
  xssFilter: true,
  // Referrer Policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for PDFs
}));

// CORS configuration
app.use(cors({
  origin: validatedConfig.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
}));

// Request ID middleware - must be early in the chain
app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Rate limiting - more lenient in development
const isDevelopment = validatedConfig.nodeEnv === 'development';
const rateLimitMax = isDevelopment 
  ? validatedConfig.rateLimit.maxRequests * 10 // 10x more lenient in development
  : validatedConfig.rateLimit.maxRequests;

const apiLimiter = rateLimit({
  windowMs: validatedConfig.rateLimit.windowMs,
  max: rateLimitMax,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') return true;
    // In development, skip rate limiting for certain frequently polled endpoints
    if (isDevelopment) {
      const frequentEndpoints = [
        '/api/notifications/unread-count',
        '/api/asset-categories',
        '/api/clients/profile/me',
      ];
      return frequentEndpoints.some(endpoint => req.path.startsWith(endpoint));
    }
    return false;
  },
});

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: validatedConfig.rateLimit.windowMs,
  max: isDevelopment ? validatedConfig.rateLimit.authMax * 5 : validatedConfig.rateLimit.authMax,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cookie parser middleware (must be before body parsing)
app.use(cookieParser());

// Body parsing middleware
// Limit set to 20MB to account for base64 encoding overhead (~33% larger than binary)
// Actual file size limit is 15MB before compression
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);

// CSRF protection for state-changing operations
import { csrfProtection } from './middleware/csrf';
app.use('/api/', csrfProtection);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log request
  logger.info('Incoming request', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
});

// Secure file serving - requires authentication
app.use('/uploads', uploadsRoutes);

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Check database connection
    const prisma = (await import('./config/database')).default;
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  } catch (error) {
    logger.error('Health check failed', error as Error, { requestId: req.id });
    res.status(503).json({ 
      status: 'error', 
      message: 'Database connection failed',
      requestId: req.id,
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/asset-categories', assetCategoriesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/invites', invitesRoutes);
app.use('/api/co2', co2Routes);
app.use('/api/buyback', buybackRoutes);
app.use('/api/sanitisation', sanitisationRoutes);
app.use('/api/grading', gradingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/organisation-profile', organisationProfileRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/inventory', inventoryRoutes);

// Error handler (must be last)
app.use(errorHandler);

export default app;
