import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma, db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { ckbAddress } = body;
    if (!ckbAddress) {
      return NextResponse.json({ error: 'Missing ckbAddress' }, { status: 400 });
    }

    // Since this is a demo environment, find the single user or find by githubId
    const user = await db.findFirstUser();
    
    if (user && user.ckbAddress === 'default_ckb_address_for_demo') {
      await prisma.user.update({
        where: { id: user.id },
        data: { ckbAddress }
      });
      return NextResponse.json({ success: true, updated: true });
    }

    return NextResponse.json({ success: true, updated: false });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, { status: 500 });
  }
}
