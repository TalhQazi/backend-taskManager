const ActivityLog = require("../models/ActivityLog");
const jwt = require("jsonwebtoken");

function getClientIp(req) {
  if (!req) return "";
  const hdr = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return hdr || req.ip || String(req.socket?.remoteAddress || req.connection?.remoteAddress || "");
}

/**
 * Audit logging middleware - captures important API actions
 * This middleware logs various actions to the ActivityLog collection
 */

// Helper function to determine action type from request
function determineAction(method, path, body) {
  // Normalize path - remove /api/ prefix for matching
  const normalizedPath = path.replace(/^\/api\//, '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  const resource = pathParts[0] || 'unknown';
  
  const actionMap = {
    POST: {
      'users': 'USER_CREATE',
      'tasks': 'TASK_CREATE',
      'employees': 'EMPLOYEE_CREATE',
      'time-entries': 'TIME_ENTRY_CREATE',
      'notifications': 'NOTIFICATION_CREATE',
      'messages': 'MESSAGE_SEND',
      'auth/login': 'AUTH_LOGIN_SUCCESS',
      'auth/register': 'USER_CREATE',
      'appliances': 'APPLIANCE_CREATE',
      'vehicles': 'VEHICLE_CREATE',
      'locations': 'LOCATION_CREATE',
      'vendors': 'VENDOR_CREATE',
      'events': 'EVENT_CREATE',
      'onboarding': 'ONBOARDING_CREATE',
      'clearhire': 'CLEARHIRE_SUBMIT',
    },
    PUT: {
      'users': 'USER_UPDATE',
      'tasks': 'TASK_UPDATE',
      'employees': 'EMPLOYEE_UPDATE',
      'time-entries': 'TIME_ENTRY_UPDATE',
      'settings': 'SETTINGS_UPDATE',
      'appliances': 'APPLIANCE_UPDATE',
      'vehicles': 'VEHICLE_UPDATE',
      'locations': 'LOCATION_UPDATE',
      'vendors': 'VENDOR_UPDATE',
      'events': 'EVENT_UPDATE',
      'onboarding': 'ONBOARDING_UPDATE',
      'clearhire': 'CLEARHIRE_RECHECK',
    },
    DELETE: {
      'users': 'USER_DELETE',
      'tasks': 'TASK_DELETE',
      'employees': 'EMPLOYEE_DELETE',
      'time-entries': 'TIME_ENTRY_DELETE',
      'appliances': 'APPLIANCE_DELETE',
      'vehicles': 'VEHICLE_DELETE',
      'locations': 'LOCATION_DELETE',
      'vendors': 'VENDOR_DELETE',
      'events': 'EVENT_DELETE',
    },
    GET: {
      'export': 'DATA_EXPORT',
    }
  };
  
  const methodActions = actionMap[method] || {};
  
  // Check for specific resource paths
  for (const [key, action] of Object.entries(methodActions)) {
    if (resource === key || normalizedPath.includes(`/${key}`)) {
      return action;
    }
  }
  
  return 'OTHER';
}

// Helper function to determine resource type
function determineResourceType(path) {
  // Normalize path - remove /api/ prefix for matching
  const normalizedPath = path.replace(/^\/api\//, '/');
  if (normalizedPath.includes('/users')) return 'user';
  if (normalizedPath.includes('/tasks')) return 'task';
  if (normalizedPath.includes('/employees')) return 'employee';
  if (normalizedPath.includes('/time-entries')) return 'time-entry';
  if (normalizedPath.includes('/notifications')) return 'notification';
  if (normalizedPath.includes('/messages')) return 'message';
  if (normalizedPath.includes('/settings')) return 'settings';
  if (normalizedPath.includes('/auth')) return 'auth';
  if (normalizedPath.includes('/appliances')) return 'appliance';
  if (normalizedPath.includes('/vehicles')) return 'vehicle';
  if (normalizedPath.includes('/locations')) return 'location';
  if (normalizedPath.includes('/vendors')) return 'vendor';
  if (normalizedPath.includes('/events') || normalizedPath.includes('/schedules')) return 'event';
  if (normalizedPath.includes('/onboarding')) return 'onboarding';
  if (normalizedPath.includes('/clearhire')) return 'clearhire';
  return 'system';
}

// Middleware to log API requests
function auditLogMiddleware(options = {}) {
  const { 
    logRequestBody = false,
    logResponseBody = false,
    sensitiveFields = ['password', 'passwordHash', 'token', 'secret'] 
  } = options;
  
  return async (req, res, next) => {
    // Best-effort auth decode so we can log actor details even when this middleware
    // runs before route-level requireAuth.
    if (!req.user) {
      try {
        const header = req.headers.authorization || "";
        const [type, token] = String(header).split(" ");
        const secret = process.env.JWT_SECRET;
        if (type === "Bearer" && token && secret) {
          req.user = jwt.verify(token, secret);
        }
      } catch {
        // ignore invalid tokens
      }
    }

    // Skip logging for GET requests (except specific ones)
    if (req.method === 'GET' && !req.path.includes('export')) {
      return next();
    }
    
    // Skip logging for activity logs endpoint itself (avoid recursion)
    if (req.path.includes('activity-logs')) {
      return next();
    }
    
    // Store original send to capture response
    const originalSend = res.send.bind(res);
    let responseBody = null;
    
    res.send = (body) => {
      responseBody = body;
      return originalSend(body);
    };
    
    // Process after response is sent
    res.on('finish', async () => {
      try {
        // Only log if there's a user (authenticated request)
        if (!req.user && !req.path.includes('/auth/login')) {
          return;
        }
        
        let action = determineAction(req.method, req.path, req.body);
        const resourceType = determineResourceType(req.path);
        
        // Skip logging failed login attempts (handled separately)
        if (action === 'AUTH_LOGIN_SUCCESS' && res.statusCode !== 200) {
          action = 'AUTH_LOGIN_FAILURE';
        }
        
        // Extract resource info from response if available
        let resourceId = '';
        let resourceName = '';
        
        if (responseBody && typeof responseBody === 'object') {
          const body = responseBody;
          if (body.item) {
            resourceId = body.item.id || body.item._id || '';
            resourceName = body.item.name || body.item.username || body.item.title || '';
          }
        }
        
        // Extract from request params or body if not in response
        if (!resourceId) {
          resourceId = req.params.id || req.body.id || '';
        }
        if (!resourceName) {
          resourceName = req.body.name || req.body.username || req.body.title || '';
        }
        
        // Build description
        const description = `${req.user?.username || 'System'} performed ${action.replace(/_/g, ' ').toLowerCase()}` +
          (resourceName ? ` on "${resourceName}"` : resourceId ? ` on resource ${resourceId}` : '');
        
        // Clean metadata - remove sensitive fields
        const metadata = {};
        if (logRequestBody && req.body) {
          const cleanedBody = { ...req.body };
          sensitiveFields.forEach(field => delete cleanedBody[field]);
          metadata.requestBody = cleanedBody;
        }
        if (logResponseBody && responseBody) {
          metadata.responseStatus = res.statusCode;
        }
        
        // Get client info
        const ipAddress = getClientIp(req);
        const userAgent = req.headers['user-agent'] || '';
        
        // Create log entry
        const logEntry = new ActivityLog({
          actorUserId: req.user?.sub || 'system',
          actorUsername: req.user?.username || 'anonymous',
          actorRole: req.user?.role || 'unknown',
          action,
          resourceType,
          resourceId: String(resourceId),
          resourceName: String(resourceName),
          description,
          ipAddress,
          userAgent,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });
        
        await logEntry.save();
        
      } catch (err) {
        // Silent fail - don't break the API if logging fails
        console.error('Audit logging error:', err.message);
      }
    });
    
    next();
  };
}

// Specific function to log login success
async function logLoginSuccess(user, req) {
  try {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    await ActivityLog.create({
      actorUserId: String(user._id),
      actorUsername: user.username,
      actorRole: user.role,
      action: 'AUTH_LOGIN_SUCCESS',
      resourceType: 'auth',
      resourceId: String(user._id),
      resourceName: user.username,
      description: `${user.username} logged in successfully`,
      ipAddress,
      userAgent,
      metadata: { loginTime: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Login logging error:', err.message);
  }
}

// Specific function to log login failure
async function logLoginFailure(username, req, reason) {
  try {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    
    await ActivityLog.create({
      actorUserId: 'unknown',
      actorUsername: username || 'anonymous',
      actorRole: 'unknown',
      action: 'AUTH_LOGIN_FAILURE',
      resourceType: 'auth',
      resourceId: '',
      resourceName: username || 'unknown',
      description: `Failed login attempt for "${username || 'unknown'}" - ${reason}`,
      ipAddress,
      userAgent,
      metadata: { attemptedUsername: username, failureReason: reason },
    });
  } catch (err) {
    console.error('Login failure logging error:', err.message);
  }
}

module.exports = {
  auditLogMiddleware,
  logLoginSuccess,
  logLoginFailure,
};
