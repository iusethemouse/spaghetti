async function call(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

export const api = {
  viewer: () => call('/api/viewer'),
  repos: (query) => call(`/api/repos?q=${encodeURIComponent(query)}`),
  pulls: (repo, fresh) => call(`/api/pulls?repo=${encodeURIComponent(repo)}${fresh ? '&fresh=1' : ''}`),
  loadState: () => call('/api/state'),
  saveState: (doc) => call('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc)
  })
};
