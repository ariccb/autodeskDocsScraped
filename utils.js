function sanitizeFilename(filename) {
  // Remove any characters that are not alphanumeric, underscore, or dash
  let sanitized = filename.replace(/[^a-z0-9_-]/gi, "_");

  // Ensure the filename ends with .html
  if (!sanitized.toLowerCase().endsWith(".html")) {
    sanitized += ".html";
  }

  return sanitized;
}

module.exports = {
  sanitizeFilename,
};
