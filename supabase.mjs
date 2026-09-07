export class SupabaseError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export const supabaseConfig = (environment) => {
  const url = String(environment.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || "");
  return url && serviceKey
    ? { url, serviceKey, bucket: environment.SUPABASE_STORAGE_BUCKET || "product-images" }
    : null;
};

export const supabaseHeaders = (config, extra = {}) => ({
  apikey: config.serviceKey,
  Authorization: `Bearer ${config.serviceKey}`,
  ...extra,
});

// Every REST call goes through here so a failure is logged once, with the
// response body, and never leaks the service-role key to the caller.
export const supabaseRequest = async (config, path, options = {}) => {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: supabaseHeaders(config, options.headers),
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("Supabase request failed", path, response.status, details.slice(0, 500));
    throw new SupabaseError(`Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
};
