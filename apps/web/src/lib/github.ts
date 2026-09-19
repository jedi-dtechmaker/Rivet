import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function fetchGitHubRepoData(fullName: string) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) return null;

  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    // Fetch latest commit for the whole repo
    const commitRes = await fetch(`https://api.github.com/repos/${fullName}/commits?per_page=1`, { headers });
    const commits = await commitRes.json();
    const latestCommit = commits[0];

    // Fetch contents (root level)
    const contentRes = await fetch(`https://api.github.com/repos/${fullName}/contents/`, { headers });
    const contents = await contentRes.json();

    if (!Array.isArray(contents)) return { latestCommit, contents: [] };

    // Fetch the latest commit for each file to get accurate message and timestamp
    const enrichedContents = await Promise.all(
      contents.map(async (file: any) => {
        try {
          const fileCommitRes = await fetch(
            `https://api.github.com/repos/${fullName}/commits?path=${file.path}&per_page=1`,
            { headers }
          );
          if (fileCommitRes.ok) {
            const fileCommits = await fileCommitRes.json();
            if (fileCommits.length > 0) {
              return {
                ...file,
                commitMessage: fileCommits[0].commit.message,
                commitDate: fileCommits[0].commit.author.date,
              };
            }
          }
        } catch (e) {
          console.error(`Failed to fetch commit for ${file.path}`);
        }
        return {
          ...file,
          commitMessage: latestCommit.commit.message,
          commitDate: latestCommit.commit.author.date,
        };
      })
    );

    return { latestCommit, contents: enrichedContents };
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function fetchGitHubCommits(fullName: string) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) return null;

  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/commits?per_page=30`, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}
