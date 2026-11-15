// One JSON line per failed request on stderr. Cloud Run turns it into a structured
// log entry (severity, request, trace) and Error Reporting groups entries with a stack.
// Never add request bodies, query strings, headers or Postgres "detail" (they can hold personal data or secrets).
const REPORTED_ERROR = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : undefined;

function errorEntry(err, req, status, originalMessage = err?.message) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : undefined;
  const severity = status >= 500 ? 'ERROR' : 'WARNING';
  const summary = `${req.method} ${route || path} -> ${status}: ${clip(originalMessage, 500) || 'Error'}`;
  const entry = {
    severity,
    // Error Reporting needs the stack inside the message of a reported error event.
    message: status >= 500 && err?.stack ? `${summary}\n${clip(err.stack, 8000)}` : summary,
    method: req.method,
    path,
    route,
    status,
    code: err?.code,
    table: err?.table,
    column: err?.column,
    constraint: err?.constraint,
    userId: req.user?.id,
    adminId: req.admin?.id,
    revision: process.env.K_REVISION,
  };
  if (status >= 500) {
    entry['@type'] = REPORTED_ERROR;
    entry.serviceContext = { service: process.env.K_SERVICE || 'itc-backend', version: process.env.K_REVISION };
    entry.context = { httpRequest: { method: req.method, url: path, responseStatusCode: status } };
  }
  const trace = String(req.get?.('x-cloud-trace-context') || '').split('/')[0];
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCS_PROJECT_ID;
  if (/^[0-9a-f]{32}$/i.test(trace) && project) entry['logging.googleapis.com/trace'] = `projects/${project}/traces/${trace}`;
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== null));
}

function logRequestError(err, req, status, originalMessage) {
  try { console.error(JSON.stringify(errorEntry(err, req, status, originalMessage))); }
  catch { console.error(err?.code || err?.message || 'Request error'); }
}

module.exports = { errorEntry, logRequestError };
