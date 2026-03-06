const ActivityLog = require("../models/ActivityLog");
const jwt = require("jsonwebtoken");

/**
 * Audit logging middleware - captures important API actions
 * This middleware logs various actions to the ActivityLog collection
 */

// Helper function to determine action type from request
function determineAction(method, path, body) {
  const pathParts = path.split('/').filter(Boolean);
  const resource = pathParts[1] || 'unknown';
  
  const actionMap = {
    POST: {
      'users': 'USER_CREATE',
      'tasks': 'TASK_CREATE',
      'employees': 'EMPLOYEE_CREATE',
      'time-entries': 'TIME_ENTRY_CREATE',
      'notifications': 'NOTIFICATION_CREATE',
      'messages': 'MESSAGE_SEND',
      'auth/login': 'AUTH_LOGIN_SUCCESS',
    },
    PUT: {
      'users': 'USER_UPDATE',
      'tasks': 'TASK_UPDATE',
      'employees': 'EMPLOYEE_UPDATE',
      'time-entries': 'TIME_ENTRY_UPDATE',
      'settings': 'SETTINGS_UPDATE',
    },
    DELETE: {
      'users': 'USER_DELETE',
      'tasks': 'TASK_DELETE',
      'employees': 'EMPLOYEE_DELETE',
      'time-entries': 'TIME_ENTRY_DELETE',
    },
    GET: {
      'export': 'DATA_EXPORT',
    }
  };
  
  const methodActions = actionMap[method] || {};
  
  // Check for specific paths
  for (const [key, action] of Object.entries(methodActions)) {
    if (path.includes(key)) {
      return action;
    }
  }
  
  return 'OTHER';
}

// Helper function to determine resource type
function determineResourceType(path) {
  if (path.includes('/users')) return 'user';
  if (path.includes('/tasks')) return 'task';
  if (path.includes('/employees')) return 'employee';
  if (path.includes('/time-entries')) return 'time-entry';
  if (path.includes('/notifications')) return 'notification';
  if (path.includes('/messages')) return 'message';
  if (path.includes('/settings')) return 'settings';
  if (path.includes('/auth')) return 'auth';
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
        const ipAddress = req.ip || req.connection.remoteAddress || '';
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
    const ipAddress = req.ip || req.connection.remoteAddress || '';
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
    const ipAddress = req.ip || req.connection.remoteAddress || '';
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
