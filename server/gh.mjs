import { execFile } from 'node:child_process';

const MAX_BUFFER = 32 * 1024 * 1024;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const message = (stderr || error.message).trim();
        reject(Object.assign(new Error(message), { code: error.code ?? 1 }));
        return;
      }
      resolve(stdout);
    });
  });
}

async function json(args) {
  return JSON.parse(await run(args));
}

async function graphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push('-F', `${key}=${value}`);
  }
  const body = await json(args);
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

export async function ready() {
  try {
    await run(['auth', 'status']);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message ?? error).split('\n')[0] };
  }
}

export async function viewer() {
  const data = await graphql('{ viewer { login avatarUrl } }');
  return data.viewer;
}

export async function searchRepos(org, query) {
  const filter = query ? `${query} in:name` : '';
  const q = `org:${org} ${filter} sort:updated`.trim();
  const path = `search/repositories?q=${encodeURIComponent(q)}&per_page=30`;
  const body = await json(['api', path]);
  return body.items.map((item) => ({
    owner: item.owner.login,
    name: item.name,
    fullName: item.full_name,
    defaultBranch: item.default_branch,
    updatedAt: item.updated_at
  }));
}

const PR_FIELDS = `
  number title url isDraft state mergeable reviewDecision updatedAt
  author{ login }
  headRefName baseRefName
  labels(first:10){ nodes{ name } }
  commits(last:1){ nodes{ commit{ statusCheckRollup{ state } } } }`;

const PR_QUERY = `
query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    defaultBranchRef{ name }
    open: pullRequests(first:100, states:OPEN, orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ ${PR_FIELDS} } }
    merged: pullRequests(first:25, states:MERGED, orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ ${PR_FIELDS} } }
  }
}`;

function shape(pull) {
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    draft: pull.isDraft,
    state: pull.state,
    mergeable: pull.mergeable,
    review: pull.reviewDecision,
    checks: pull.commits.nodes[0]?.commit?.statusCheckRollup?.state ?? null,
    author: pull.author?.login ?? null,
    head: pull.headRefName,
    base: pull.baseRefName,
    labels: pull.labels.nodes.map((label) => label.name),
    updatedAt: pull.updatedAt
  };
}

export async function listPullRequests(owner, name) {
  const data = await graphql(PR_QUERY, { owner, name });
  const repo = data.repository;
  if (!repo) throw new Error(`no repository ${owner}/${name}`);
  return {
    defaultBranch: repo.defaultBranchRef?.name ?? null,
    pulls: [...repo.open.nodes, ...repo.merged.nodes].map(shape)
  };
}
