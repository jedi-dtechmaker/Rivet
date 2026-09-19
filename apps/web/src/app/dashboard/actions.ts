'use server';

import { db } from '@/lib/db';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function syncGitHubRepos() {
  revalidatePath('/dashboard');
}

export async function getReposByAddress(address: string) {
  if (!address) return [];
  
  try {
    let user = await prisma.user.findFirst({
      where: { ckbAddress: address },
      include: {
        repositories: {
          orderBy: { updatedAt: 'desc' }
        }
      }
    });

    // Fallback for demo environment where DB stores 'default_ckb_address_for_demo'
    if (!user) {
      user = await prisma.user.findFirst({
        include: {
          repositories: {
            orderBy: { updatedAt: 'desc' }
          }
        }
      });
    }
    
    return user?.repositories || [];
  } catch (error) {
    console.error('Failed to get repos by address:', error);
    return [];
  }
}
