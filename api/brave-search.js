// Brave Search API integration for SoulSearch
// Uses Brave's Web Search API - requires an API key from https://api.search.brave.com/

export async function braveSearch(query, apiKey, count = 5) {
  if (!apiKey) {
    throw new Error('Brave API key not configured - add it in Settings');
  }
  
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  
  const r = await fetch(url, {
    headers: {
      'X-Subscription-Token': apiKey,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });
  
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`Brave ${r.status}: ${err.message || r.statusText}`);
  }
  
  const data = await r.json();
  
  return data.web?.results?.map(result => ({
    title: result.title,
    url: result.url,
    snippet: result.description
  })) || [];
}

// Helper to detect search intent in user messages
export function hasSearchIntent(message) {
  const searchPatterns = [
    /\bsearch\s+(for|the\s+web|online)\b/i,
    /\blook\s+up\b/i,
    /\bfind\s+online\b/i,
    /\bgoogle\b/i,
    /\bwhat('s|s| is)\s+(the\s+)?latest\b/i,
    /\bcurrent\s+(news|events|status)\b/i
  ];
  
  return searchPatterns.some(pattern => pattern.test(message));
}

// Extract search query from user message
export function extractSearchQuery(message) {
  // Remove common prefixes
  let query = message
    .replace(/^(please\s+)?(can\s+you\s+)?(search\s+(for|the\s+web|online)\s*|look\s+up\s*|find\s+online\s*|google\s*)/i, '')
    .replace(/\?$/, '')
    .trim();
  
  // If we stripped everything, use original message
  if (query.length < 3) {
    query = message.replace(/\?$/, '').trim();
  }
  
  return query;
}
