function sanitizeFilename(url) {
  // Remove the protocol and domain
  let filename = url.replace(/^https?:\/\/[^\/]+/, "");

  // Remove trailing slash if present
  filename = filename.replace(/\/$/, "");

  // Replace remaining slashes with underscores
  filename = filename.replace(/\//g, "_");

  // Remove any characters that are not alphanumeric, underscore, or hyphen
  filename = filename.replace(/[^a-z0-9_-]/gi, "");

  return filename;
}

module.exports = {
  sanitizeFilename,
};
