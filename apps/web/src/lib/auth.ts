import { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import { db } from '@/lib/db';

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
      authorization: {
        params: { scope: 'read:user user:email repo' },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      if (!profile) return true;
      
      const githubId = (profile as any).id?.toString();
      const githubUsername = (profile as any).login as string;
      
      if (githubId) {
        try {
          const existingUser = await db.findUserByGithubId(githubId);
          if (!existingUser) {
            await db.createUser({
              githubId,
              githubUsername,
            });
          }
        } catch (error) {
          console.error("Error creating user during sign in:", error);
        }
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
