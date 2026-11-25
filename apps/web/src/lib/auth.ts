import { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import { prisma, readWithConnectionRetry } from '@/lib/db';
import { recordSignIn } from '@/lib/analytics';

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
      httpOptions: {
        timeout: 30_000,
      },
      authorization: {
        params: { scope: 'read:user user:email repo admin:repo_hook' },
      },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      if (!profile) return false;

      const githubId = (profile as any).id?.toString();
      const githubUsername = (profile as any).login as string;
      
      if (!githubId || !/^\d+$/.test(githubId)) return false;
      try {
        const user = await readWithConnectionRetry(() => prisma.user.upsert({
          where: { githubId },
          create: { githubId, githubUsername },
          update: githubUsername ? { githubUsername } : {},
          select: { id: true },
        }));
        await recordSignIn(user.id);
      } catch {
        console.error('[auth] Could not save the GitHub account.');
        return false;
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      const profileId = (profile as any)?.id;
      if (profileId) {
        token.githubId = profileId.toString();
      }
      return token;
    },
    async session({ session, token }) {
      // @ts-ignore
      session.accessToken = token.accessToken;
      // @ts-ignore
      if (session.user && token.githubId) {
        // @ts-ignore
        session.user.id = token.githubId;
      }
      return session;
    },
  },
};
