// The only network destination in the hosted application.
const GITHUB = 'https://api.github.com';
const TOKEN = 'spaghetti.token';
const USER = 'spaghetti.user';
const ORG = 'spaghetti.org';
let token = '';
let user = null;
let org = 'knime';

try {
  token = sessionStorage.getItem(TOKEN) ?? '';
  user = JSON.parse(sessionStorage.getItem(USER) ?? localStorage.getItem(USER) ?? 'null');
  org = localStorage.getItem(ORG) ?? org;
} catch {
  // Storage may be disabled. Connecting will explain the failure.
}

async function request(path, options = {}, credential = token) {
  if (!credential) throw new Error('Paste a GitHub token to connect.');
  const response = await fetch(GITHUB + path, {
    ...options,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential}`, ...options.headers }
  });
  const body = await response.json();
  if (!response.ok) {
    let message = body.message ?? `GitHub returned ${response.status}.`;
    if (response.status === 401) message = 'This token is invalid or expired. Paste a new token.';
    else if (response.headers.get('x-github-sso')?.includes('required')) {
      message = 'Authorize this token for your organization’s SSO in GitHub token settings, then retry.';
    } else if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      message = 'GitHub rate limit reached. Try again after a few minutes.';
    } else if (response.status === 404) {
      message = 'Repository unavailable. Check the token’s repository access and SSO authorization.';
    }
    throw new Error(message);
  }
  return body;
}

async function graphql(query, variables) {
  const body = await request('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join('; '));
  return body.data;
}

const PR_FIELDS = `
  number title url isDraft state mergeable reviewDecision updatedAt
  author { login } headRefName baseRefName
  labels(first:10) { nodes { name } }
  commits(last:1) { nodes { commit { statusCheckRollup { state } } } }`;

const PR_QUERY = `query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    defaultBranchRef { name }
    open: pullRequests(first:100, states:OPEN, orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${PR_FIELDS} } }
    merged: pullRequests(first:25, states:MERGED, orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${PR_FIELDS} } }
  }
}`;

function stateKey() {
  return `spaghetti.state.${user?.id ?? 'guest'}`;
}

export const api = {
  hosted: true,
  get connected() { return Boolean(token); },
  get org() { return org; },
  async connect(value, organization) {
    const candidate = value.trim();
    if (!candidate || /\s/.test(candidate)) throw new Error('Paste a GitHub token without spaces.');
    const nextOrg = organization.trim();
    if (nextOrg && !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(nextOrg)) {
      throw new Error('Enter an organization name, such as knime.');
    }
    const profile = await request('/user', {}, candidate);
    const nextUser = { id: profile.id, login: profile.login };
    // Validate before replacing the active credential or account's local board.
    sessionStorage.setItem(TOKEN, candidate);
    sessionStorage.setItem(USER, JSON.stringify(nextUser));
    localStorage.setItem(USER, JSON.stringify(nextUser));
    localStorage.setItem(ORG, nextOrg);
    token = candidate;
    user = nextUser;
    org = nextOrg;
  },
  disconnect() {
    token = '';
    sessionStorage.removeItem(TOKEN);
    sessionStorage.removeItem(USER);
  },
  async viewer() {
    return { viewer: user, org };
  },
  async repos(query) {
    const filter = query ? `${query} in:name` : '';
    const q = `${org ? `org:${org}` : ''} ${filter} sort:updated`.trim();
    const body = await request(`/search/repositories?q=${encodeURIComponent(q)}&per_page=30`);
    return { repos: body.items.map((item) => ({
      owner: item.owner.login, name: item.name, fullName: item.full_name,
      defaultBranch: item.default_branch, updatedAt: item.updated_at
    })) };
  },
  async pulls(repo) {
    const [owner, name] = repo.split('/');
    const data = await graphql(PR_QUERY, { owner, name });
    if (!data.repository) throw new Error(`Cannot access ${repo}. Check token permissions and SSO.`);
    return {
      defaultBranch: data.repository.defaultBranchRef?.name ?? null,
      pulls: [...data.repository.open.nodes, ...data.repository.merged.nodes].map((pull) => ({
        number: pull.number, title: pull.title, url: pull.url, draft: pull.isDraft,
        state: pull.state, mergeable: pull.mergeable, review: pull.reviewDecision,
        checks: pull.commits.nodes[0]?.commit?.statusCheckRollup?.state ?? null,
        author: pull.author?.login ?? null, head: pull.headRefName, base: pull.baseRefName,
        labels: pull.labels.nodes.map((label) => label.name), updatedAt: pull.updatedAt
      }))
    };
  },
  async loadState() {
    const saved = localStorage.getItem(stateKey());
    return saved ? JSON.parse(saved) : { version: 2, active: null, bundles: [] };
  },
  async saveState(doc) {
    localStorage.setItem(stateKey(), JSON.stringify(doc));
  }
};
